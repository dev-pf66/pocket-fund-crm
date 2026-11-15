// Weekly sales digest. Computes an IST week (Mon–Sun) per analyst — meetings,
// replies, reply rate, demos, and outreach volume — with deltas vs the week
// before.
//
// Nov 2026 (Dev: "fix/improve this to a part of the plan page"): the digest is
// READ on the task tracker's /plan page, from GET ?view=data (x-api-key), and is
// no longer filed as a Monday Sage task — each one sat overdue on his list.
// The Monday cron (03:30 UTC = 9:00 IST) still runs: it writes the heartbeat
// /api/health reports, and files a task only when the CallHippo watchdog fires
// or the run itself fails.
//
// Reports OUTCOMES first, volume second (Dev, Aug 2026): sales moved to a
// smaller, more targeted motion, so a digest ranked by send count read the
// strategy as failure. Don't re-sort this by outreach.
//
// Manual runs: GET/POST with Authorization: Bearer $CRON_SECRET.
//   ?dry_run=1  → returns the digest text and data without filing anything.
// Data: GET ?view=data[&week=YYYY-MM-DD] with x-api-key: $CRM_API_KEY.

import { createClient } from '@supabase/supabase-js'
import { tt } from '../src/lib/integrations/task-tracker.js'
import { MEETING_HELD_ACTIVITY_TYPES } from '../src/lib/meetingCounts.js'
import { isReply } from '../src/lib/outreachStatus.js'
import { requireEnv } from './_env.js'
import { fetchAllRows } from './_db.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const DIGEST_ASSIGNEE_EMAIL = 'dev@pocket-fund.com'
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

function istDateStr(ms = Date.now()) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10)
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
// Monday of the IST week containing dateStr
function weekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7 // Mon=0
  return addDays(dateStr, -dow)
}

const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : 0)
const delta = (curr, prev) => {
  const diff = curr - prev
  if (diff === 0) return '±0'
  return diff > 0 ? `▲${diff}` : `▼${Math.abs(diff)}`
}

/**
 * Pure aggregation — no DB. Split out from the fetching so the accountability
 * rules (everyone listed zeros included, TEAM line sums only the listed rows)
 * are unit-testable. See test/weekly-digest.test.js.
 *
 * Returns STRUCTURED numbers. Two readers render them: composeDigest() below
 * (the plain-text version, kept for ?dry_run=1 and the tests), and the task
 * tracker's /plan page, which reads GET ?view=data. Since Nov 2026 the digest
 * is no longer filed as a Monday Sage task — Dev: "fix/improve this to a part
 * of the plan page". A task that is a report never gets "done"; it just sat
 * overdue on his list every week.
 *
 * `week` is any date in the week to report (normalised to its Monday). Omitted,
 * it is the last full Mon–Sun week before `today`. A week that has not ended
 * yet is reported as `partial`.
 */
export function computeDigest({ people: allPeople, outreach, meetings, demos, today, week }) {
  const lastStart = week ? weekStart(week) : addDays(weekStart(today), -7)
  const lastEnd = addDays(lastStart, 6)
  const prevStart = addDays(lastStart, -7)
  const prevEnd = addDays(lastStart, -1)

  const inLast = (d) => d >= lastStart && d <= lastEnd
  const inPrev = (d) => d >= prevStart && d <= prevEnd

  const blank = () => ({
    outreach: 0, replies: 0, meetings: 0, demos: 0, signups: 0,
    prevOutreach: 0, prevReplies: 0, prevMeetings: 0
  })
  const perPerson = new Map()
  const statsFor = (pid) => {
    if (!perPerson.has(pid)) perPerson.set(pid, blank())
    return perPerson.get(pid)
  }

  for (const r of outreach || []) {
    const s = statsFor(r.logged_by)
    if (inLast(r.outreach_date)) {
      s.outreach += 1
      if (isReply(r.status)) s.replies += 1
    } else if (inPrev(r.outreach_date)) {
      s.prevOutreach += 1
      if (isReply(r.status)) s.prevReplies += 1
    }
  }
  for (const r of meetings || []) {
    const d = String(r.activity_date).slice(0, 10)
    const s = statsFor(r.logged_by)
    if (inLast(d)) s.meetings += 1
    else if (inPrev(d)) s.prevMeetings += 1
  }
  for (const r of demos || []) {
    const s = statsFor(r.created_by)
    if (inLast(r.demo_date)) {
      s.demos += 1
      if (r.stage === 'signed_up') s.signups += 1
    }
  }

  // dev+localtest is a test account — the scoreboard and the MCP roster
  // exclude it, and it was showing up in the digest's "No activity" line.
  const people = (allPeople || []).filter(p => !p.is_archived && !/\+localtest/.test(p.email || ''))

  // Sum only the people the digest actually lists. Summing every entry in
  // perPerson included departed/archived analysts, so the TEAM line came out
  // higher than the per-person rows underneath it added up to.
  const team = blank()
  for (const p of people) {
    const s = perPerson.get(p.id)
    if (!s) continue
    for (const k of Object.keys(team)) team[k] += s[k]
  }

  // Ranked by what moved (meetings, then replies, then reply rate) rather than
  // who sent most — outcomes lead, volume is context (Dev, Aug 2026).
  const rows = people
    .map(p => ({ id: p.id, name: p.name, ...(perPerson.get(p.id) || blank()) }))
    .sort((a, b) =>
      b.meetings - a.meetings ||
      b.replies - a.replies ||
      pct(b.replies, b.outreach) - pct(a.replies, a.outreach) ||
      String(a.name).localeCompare(String(b.name))
    )
  // Every active person is still named (Dev, July 2026): anyone with nothing
  // at all collapses into one "No activity" list rather than a dozen rows of
  // zeros. Touches logged with no outcome yet is work, NOT silence, so it
  // keeps its own row (Dev, Aug 2026).
  const didSomething = (s) => s.outreach > 0 || s.replies > 0 || s.meetings > 0 || s.demos > 0
  const withRate = (s) => ({ ...s, replyRate: pct(s.replies, s.outreach) })

  // Rows with no person behind them — CallHippo imports arrive unclaimed. They
  // are reported, never folded into the team line (same rule as the scoreboard).
  const unattributed = perPerson.get(null)?.outreach || 0

  return {
    week: { start: lastStart, end: lastEnd },
    prev: { start: prevStart, end: prevEnd },
    partial: Boolean(today) && today <= lastEnd,
    team: withRate(team),
    active: rows.filter(didSomething).map(withRate),
    quiet: rows.filter(s => !didSomething(s)).map(s => s.name).sort(),
    unattributed,
    // A quiet week is only worth calling out when nothing MOVED. Low send
    // volume is the plan now, so it is no longer the thing to flag.
    nothingMoved: team.meetings === 0 && team.replies === 0 && team.demos === 0,
  }
}

/** The plain-text digest, rendered from computeDigest(). */
export function composeDigest(args) {
  const d = computeDigest(args)
  const { team } = d
  const lines = []
  lines.push(`Week of ${d.week.start} – ${d.week.end} (vs prior week)`)
  lines.push('')

  // These are meetings HELD, and the wording says so. The meeting activity is
  // auto-logged when a lead LEAVES meeting_booked moving forward, because
  // meeting_booked means "agreed to meet", not "met" — so this number is
  // conversations that happened, not bookings made.
  lines.push(
    `TEAM — what moved: ${team.meetings} meetings held (${delta(team.meetings, team.prevMeetings)}) · ` +
    `${team.replies} replies (${team.replyRate}% of ${team.outreach} touches, ${delta(team.replies, team.prevReplies)}) · ` +
    `${team.demos} demos${team.signups ? ` (${team.signups} signed up)` : ''}`
  )
  lines.push(`Volume: ${team.outreach} outreach (${delta(team.outreach, team.prevOutreach)})`)
  lines.push('')

  for (const s of d.active) {
    lines.push(
      `${s.name}: ${s.meetings} meetings held (${delta(s.meetings, s.prevMeetings)}) · ` +
      `${s.replies} replies (${s.replyRate}% of ${s.outreach} touches, ${delta(s.outreach, s.prevOutreach)})` +
      `${s.demos ? ` · ${s.demos} demos` : ''}${s.signups ? ` · ${s.signups} signups` : ''}`
    )
  }
  if (d.quiet.length) {
    if (d.active.length) lines.push('')
    lines.push(`No activity (${d.quiet.length}): ${d.quiet.join(', ')}`)
  }
  if (d.nothingMoved) {
    lines.push('', `Nothing moved last week — no replies, meetings or demos logged${team.outreach ? ` (${team.outreach} touches went out).` : '.'}`)
  }

  return { weekKey: d.week.start, title: `Weekly Outreach Digest — w/o ${d.week.start}`, body: lines.join('\n') }
}

/**
 * Independent watchdog on the CallHippo importer, rendered as extra lines for
 * the weekly digest.
 *
 * The importer writes its own heartbeat, but a cron that never FIRES writes
 * nothing at all — and that failure is invisible in exactly the case that
 * costs the most: CallHippo deletes call logs after about a month, so a
 * silently dead sync destroys dials rather than delaying them.
 *
 * This digest is a separate cron on a separate schedule, so it still runs
 * when that one doesn't. Two independent jobs failing in the same week is far
 * less likely than one.
 *
 * Never throws — a watchdog must not be able to break the digest it rides on.
 * Returns [] when the sync is healthy.
 */
async function callSyncWarningLines() {
  try {
    const { data } = await supabase
      .from('crm_cron_runs')
      .select('ran_at')
      .eq('job', 'callhippo-sync')
      .eq('status', 'ok')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const ageDays = data?.ran_at
      ? Math.floor((Date.now() - Date.parse(data.ran_at)) / 86400000)
      : null

    const FIX = '   Fix: curl -H "Authorization: Bearer $CRON_SECRET" https://pocket-fund-crm.vercel.app/api/callhippo-sync'

    if (ageDays === null) {
      return ['', '⚠️ CallHippo call sync has NEVER completed — no dials are being imported.', FIX]
    }
    // Daily job: one missed night is noise, two is a pattern.
    if (ageDays >= 2) {
      return [
        '',
        `⚠️ CallHippo call sync last succeeded ${ageDays} days ago.` +
          (ageDays >= 25
            ? ' CallHippo keeps only ~30 days of logs — dials are being permanently lost right now.'
            : ' CallHippo keeps only ~30 days of logs, so this cannot wait.'),
        FIX,
      ]
    }
    return []
  } catch (e) {
    console.error('weekly-digest: call-sync watchdog failed', e)
    return []
  }
}

async function buildDigest({ week } = {}) {
  const today = istDateStr()
  const lastStart = week ? weekStart(week) : addDays(weekStart(today), -7)
  const lastEnd = addDays(lastStart, 6)
  const prevStart = addDays(lastStart, -7)

  // Paged: two weeks of team-wide outreach clears PostgREST's 1000-row cap on
  // a busy fortnight, and a truncated page comes back with no error — the
  // digest would just quietly under-report everyone.
  const [people, outreach, meetings, demos] = await Promise.all([
    fetchAllRows(() => supabase.from('people').select('id, name, email, is_archived')),
    fetchAllRows(() => supabase.from('crm_outreach_log')
      .select('logged_by, outreach_date, status')
      .gte('outreach_date', prevStart).lte('outreach_date', lastEnd)),
    fetchAllRows(() => supabase.from('crm_lead_activities')
      .select('logged_by, activity_date')
      // MEETINGS HELD ONLY. This used to be ['call', 'meeting'], so a logged
      // phone call was reported to Dev as a meeting in the first line of the
      // Monday digest. Calls belong in the outreach/dial counts, where they
      // already are. Shared with the CRM scoreboard via meetingCounts.js so the
      // two cannot drift — Dev, 27 Sept: "Sage and CRM should not at all
      // disagree with meetings."
      .in('activity_type', MEETING_HELD_ACTIVITY_TYPES)
      .gte('activity_date', prevStart).lt('activity_date', addDays(lastEnd, 1))),
    fetchAllRows(() => supabase.from('crm_demos')
      .select('created_by, demo_date, stage')
      .not('demo_date', 'is', null)
      .gte('demo_date', prevStart).lte('demo_date', lastEnd))
  ])

  const input = { people, outreach, meetings, demos, today, week: lastStart }
  const data = computeDigest(input)
  const digest = composeDigest(input)

  // Appended after composing so composeDigest stays pure and synchronous —
  // its guardrail tests depend on that.
  const warning = await callSyncWarningLines()
  return {
    data,
    warnings: warning.filter(l => l.trim()),
    digest: warning.length ? { ...digest, body: `${digest.body}\n${warning.join('\n')}` } : digest,
  }
}

// Heartbeat. Best-effort by design: a logging failure must never be the reason
// the digest itself fails.
async function recordRun(runKey, status, detail) {
  try {
    await supabase.from('crm_cron_runs').insert({
      job: 'weekly-digest', run_key: runKey, status, detail: detail ? String(detail).slice(0, 500) : null
    })
  } catch (e) {
    console.error('weekly-digest: could not record run', e)
  }
}

// Dev's task-tracker person id, by email.
async function resolveAssignee() {
  const ttUrl = process.env.TASK_TRACKER_API_URL
  const ttKey = process.env.TASK_TRACKER_API_KEY
  const teamRes = await fetch(`${ttUrl}/team`, { headers: { 'x-api-key': ttKey } })
  const ttTeam = teamRes.ok ? await teamRes.json() : []
  return ttTeam.find(p => (p.email || '').toLowerCase() === DIGEST_ASSIGNEE_EMAIL)?.id || null
}

/**
 * A failed run must be as visible as a successful one. Success shows up as the
 * Monday digest task; failure used to show up as nothing at all (a 500 in the
 * Vercel log nobody reads). Now it files its own task, idempotent per week so
 * a retrying cron can't spam the tracker.
 *
 * Note the remaining gap, by design: if the cron never fires at all, nothing
 * here runs. The digest task's own absence is the signal — no task in Sage on
 * a Monday morning means the automation is dead.
 */
async function alertFailure(weekKey, err) {
  const key = weekKey || istDateStr()
  try {
    const { data: existing } = await supabase
      .from('crm_tt_mappings')
      .select('tt_task_id')
      .eq('entity_type', 'weekly_digest_failure')
      .eq('entity_key', key)
      .maybeSingle()
    if (existing?.tt_task_id) return

    const assignee = await resolveAssignee()
    const task = await tt.createTask({
      title: `⚠️ Weekly Outreach Digest FAILED — w/o ${key}`,
      description:
        `The weekly digest cron (/api/weekly-digest) errored and no digest was filed.\n\n` +
        `Error: ${err.message}\n\n` +
        `Check the Vercel function log, then re-run manually:\n` +
        `  curl -H "Authorization: Bearer $CRON_SECRET" https://pocket-fund-crm.vercel.app/api/weekly-digest`,
      priority: 'high',
      status: 'not_started',
      due_date: istDateStr(),
      assigned_to: assignee,
      created_by: assignee
    })

    await supabase.from('crm_tt_mappings').upsert({
      entity_type: 'weekly_digest_failure',
      entity_key: key,
      tt_task_id: task.id,
      metadata: { error: err.message }
    }, { onConflict: 'entity_type,entity_key' })
  } catch (e) {
    // The tracker being down is a plausible cause of the original failure.
    console.error('weekly-digest: could not file failure alert', e)
  }
}

// Header-only API key, as everywhere else (api/_auth.js). Boolean(validKey)
// first, or an unset CRM_API_KEY authenticates `undefined === undefined`.
function hasApiKey(req) {
  const validKey = process.env.CRM_API_KEY
  return Boolean(validKey) && req.headers['x-api-key'] === validKey
}

/**
 * GET ?view=data[&week=YYYY-MM-DD] — the digest as JSON, for the task
 * tracker's /plan page (which calls it server-side with CRM_API_KEY, so the
 * key never reaches a browser). Read-only: files nothing, records no run.
 */
async function handleData(req, res) {
  if (!requireEnv(res, ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRM_API_KEY'])) return
  if (!hasApiKey(req)) return res.status(401).json({ success: false, error: 'Unauthorized' })
  const week = req.query?.week
  if (week && (!/^\d{4}-\d{2}-\d{2}$/.test(week) || isNaN(Date.parse(`${week}T00:00:00Z`)))) {
    return res.status(400).json({ success: false, error: 'week must be YYYY-MM-DD' })
  }
  if (week && weekStart(week) > weekStart(istDateStr())) {
    return res.status(400).json({ success: false, error: 'week is in the future' })
  }
  try {
    const { data, warnings } = await buildDigest({ week })
    return res.status(200).json({ success: true, data: { ...data, warnings } })
  } catch (e) {
    console.error('weekly-digest data error:', e)
    return res.status(500).json({ success: false, error: e.message })
  }
}

/**
 * The CallHippo watchdog still needs a voice now that the digest is not a task:
 * when it fires, file ONE task for that week (idempotent via crm_tt_mappings),
 * because "dials are being permanently lost" is an action, not a report.
 */
async function fileWarningTask(weekKey, warnings) {
  const { data: existing } = await supabase
    .from('crm_tt_mappings')
    .select('tt_task_id')
    .eq('entity_type', 'weekly_digest_warning')
    .eq('entity_key', weekKey)
    .maybeSingle()
  if (existing?.tt_task_id) return existing.tt_task_id

  const assignee = await resolveAssignee()
  const task = await tt.createTask({
    title: `⚠️ CallHippo call sync needs attention — w/o ${weekKey}`,
    description: `${warnings.join('\n')}\n\nRaised by the Monday outreach check (/api/weekly-digest). The weekly numbers themselves are on the tracker's Plan page.`,
    priority: 'high',
    status: 'not_started',
    due_date: istDateStr(),
    assigned_to: assignee,
    created_by: assignee
  })
  await supabase.from('crm_tt_mappings').upsert({
    entity_type: 'weekly_digest_warning',
    entity_key: weekKey,
    tt_task_id: task.id,
    metadata: { warnings }
  }, { onConflict: 'entity_type,entity_key' })
  return task.id
}

export default async function handler(req, res) {
  if (req.method === 'GET' && req.query?.view === 'data') return handleData(req, res)

  if (!requireEnv(res, [
    'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET',
    'TASK_TRACKER_API_URL', 'TASK_TRACKER_API_KEY'
  ])) return

  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  let weekKey = null
  try {
    const { data, warnings, digest } = await buildDigest()
    weekKey = digest.weekKey
    const dryRun = req.query?.dry_run === '1'
    if (dryRun) return res.status(200).json({ ok: true, dry_run: true, ...digest, data, warnings })

    // The digest itself is no longer a Sage task (Dev, Nov 2026): it lives on
    // the tracker's Plan page, read live from ?view=data. This run still does
    // the two jobs that must not depend on anyone opening a page — the
    // CallHippo watchdog, and the heartbeat that /api/health reports.
    if (warnings.length) {
      const ttTaskId = await fileWarningTask(digest.weekKey, warnings)
      await recordRun(digest.weekKey, 'ok', `warning filed, tt_task_id=${ttTaskId}`)
      return res.status(200).json({ ok: true, week: digest.weekKey, warning_task_id: ttTaskId })
    }
    await recordRun(digest.weekKey, 'ok', 'no task: digest lives on the tracker Plan page')
    return res.status(200).json({ ok: true, week: digest.weekKey, filed: false })
  } catch (e) {
    console.error('weekly-digest error:', e)
    await recordRun(weekKey, 'failed', e.message)
    await alertFailure(weekKey, e)
    return res.status(500).json({ error: e.message })
  }
}
