// Weekly outreach digest → Sage task tracker.
// Vercel cron hits this Monday 9:00 IST (03:30 UTC). Computes last IST week
// (Mon–Sun) per analyst — outreach, replies, reply rate, meetings, demos —
// with deltas vs the week before, and files it as a due-dated task assigned
// to Dev in the task tracker. Idempotent per week via crm_tt_mappings.
//
// Manual runs: GET/POST with Authorization: Bearer $CRON_SECRET.
//   ?dry_run=1  → returns the digest text without creating the task.

import { createClient } from '@supabase/supabase-js'
import { tt } from '../src/lib/integrations/task-tracker.js'

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

async function buildDigest() {
  const today = istDateStr()
  const lastStart = addDays(weekStart(today), -7)
  const lastEnd = addDays(lastStart, 6)
  const prevStart = addDays(lastStart, -7)
  const prevEnd = addDays(lastStart, -1)

  const [peopleRes, outreachRes, meetingsRes, demosRes] = await Promise.all([
    supabase.from('people').select('id, name, is_archived'),
    supabase.from('crm_outreach_log')
      .select('logged_by, outreach_date, status')
      .gte('outreach_date', prevStart).lte('outreach_date', lastEnd),
    supabase.from('crm_lead_activities')
      .select('logged_by, activity_date')
      .in('activity_type', ['call', 'meeting'])
      .gte('activity_date', prevStart).lt('activity_date', addDays(lastEnd, 1)),
    supabase.from('crm_demos')
      .select('created_by, demo_date, stage')
      .not('demo_date', 'is', null)
      .gte('demo_date', prevStart).lte('demo_date', lastEnd)
  ])
  for (const r of [peopleRes, outreachRes, meetingsRes, demosRes]) {
    if (r.error) throw r.error
  }

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

  for (const r of outreachRes.data || []) {
    const s = statsFor(r.logged_by)
    if (inLast(r.outreach_date)) {
      s.outreach += 1
      if (r.status === 'replied') s.replies += 1
    } else if (inPrev(r.outreach_date)) {
      s.prevOutreach += 1
      if (r.status === 'replied') s.prevReplies += 1
    }
  }
  for (const r of meetingsRes.data || []) {
    const d = String(r.activity_date).slice(0, 10)
    const s = statsFor(r.logged_by)
    if (inLast(d)) s.meetings += 1
    else if (inPrev(d)) s.prevMeetings += 1
  }
  for (const r of demosRes.data || []) {
    const s = statsFor(r.created_by)
    if (inLast(r.demo_date)) {
      s.demos += 1
      if (r.stage === 'signed_up') s.signups += 1
    }
  }

  const people = (peopleRes.data || []).filter(p => !p.is_archived)
  const nameOf = new Map(people.map(p => [p.id, p.name]))

  const team = blank()
  for (const s of perPerson.values()) {
    for (const k of Object.keys(team)) team[k] += s[k]
  }

  const lines = []
  lines.push(`Week of ${lastStart} – ${lastEnd} (vs prior week)`)
  lines.push('')
  lines.push(
    `TEAM: ${team.outreach} outreach (${delta(team.outreach, team.prevOutreach)}) · ` +
    `${team.replies} replies (${pct(team.replies, team.outreach)}% rate, ${delta(team.replies, team.prevReplies)}) · ` +
    `${team.meetings} meetings (${delta(team.meetings, team.prevMeetings)}) · ` +
    `${team.demos} demos${team.signups ? ` (${team.signups} signed up)` : ''}`
  )
  lines.push('')

  const rows = [...perPerson.entries()]
    .filter(([pid, s]) => nameOf.has(pid) && (s.outreach || s.prevOutreach || s.meetings))
    .sort((a, b) => b[1].outreach - a[1].outreach)
  for (const [pid, s] of rows) {
    lines.push(
      `${nameOf.get(pid)}: ${s.outreach} outreach (${delta(s.outreach, s.prevOutreach)}) · ` +
      `${s.replies} replies (${pct(s.replies, s.outreach)}%) · ` +
      `${s.meetings} meetings${s.demos ? ` · ${s.demos} demos` : ''}${s.signups ? ` · ${s.signups} signups` : ''}`
    )
  }
  if (rows.length === 0) lines.push('No outreach logged by anyone last week.')

  return { weekKey: lastStart, title: `Weekly Outreach Digest — w/o ${lastStart}`, body: lines.join('\n') }
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const digest = await buildDigest()
    const dryRun = req.query?.dry_run === '1'
    if (dryRun) return res.status(200).json({ ok: true, dry_run: true, ...digest })

    // One digest per week, even if the cron double-fires.
    const { data: existing } = await supabase
      .from('crm_tt_mappings')
      .select('tt_task_id')
      .eq('entity_type', 'weekly_digest')
      .eq('entity_key', digest.weekKey)
      .maybeSingle()
    if (existing?.tt_task_id) {
      return res.status(200).json({ ok: true, skipped: 'already_sent', tt_task_id: existing.tt_task_id })
    }

    // Resolve Dev's task-tracker person id by email.
    const ttUrl = process.env.TASK_TRACKER_API_URL
    const ttKey = process.env.TASK_TRACKER_API_KEY
    const teamRes = await fetch(`${ttUrl}/team`, { headers: { 'x-api-key': ttKey } })
    const ttTeam = teamRes.ok ? await teamRes.json() : []
    const assignee = ttTeam.find(p => (p.email || '').toLowerCase() === DIGEST_ASSIGNEE_EMAIL)?.id || null

    const task = await tt.createTask({
      title: digest.title,
      description: digest.body,
      priority: 'medium',
      status: 'not_started',
      due_date: istDateStr(), // today (Monday) — every task gets a due date
      assigned_to: assignee,
      created_by: assignee
    })

    await supabase.from('crm_tt_mappings').upsert({
      entity_type: 'weekly_digest',
      entity_key: digest.weekKey,
      tt_task_id: task.id,
      metadata: { title: digest.title }
    }, { onConflict: 'entity_type,entity_key' })

    return res.status(200).json({ ok: true, tt_task_id: task.id, week: digest.weekKey })
  } catch (e) {
    console.error('weekly-digest error:', e)
    return res.status(500).json({ error: e.message })
  }
}
