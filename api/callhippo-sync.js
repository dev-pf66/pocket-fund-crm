// CallHippo → CRM call importer.
//
// The team dials on CallHippo, not from the CRM, so calls only reach us by
// import. Vercel cron runs this daily; it can also be driven by hand with
// Authorization: Bearer $CRON_SECRET (?days=30&dry_run=1).
//
// THREE FACTS FROM THEIR API (verified against real records, Sept 2026):
//
//  1. Call logs older than ONE MONTH are refused outright on this plan
//     ("Kindly upgrade your plan to access call logs for more than
//     1 month(s)"). There is no backfill. A call not imported within 30 days
//     is gone permanently — which is why this runs daily and why the raw
//     record is stored in provider_payload forever.
//
//  2. Every call is logged under one shared seat, so the API cannot say WHICH
//     analyst dialled. Imported calls arrive UNCLAIMED (logged_by NULL) and a
//     person claims their own. Guessing an owner would put fake numbers on
//     somebody's scorecard, which is worse than no numbers.
//
//  3. There is no outcome in their data — `callStatus` says whether the line
//     connected, not whether you reached the decision maker. call_outcome is
//     left NULL for a human tap. The funnel counts a dial with no outcome as
//     a dial and nothing more, so pickup/conversation rates stay honest.
//
// Their pagination: POST /v1/activityfeed with skip/limit (max 50 observed)
// and a { data: { callLogs, hasNext } } envelope.

import { createClient } from '@supabase/supabase-js'
import { requireEnv } from './_env.js'
import { fetchAllRows } from './_db.js'

const BASE = 'https://web.callhippo.com/v1'
const PAGE = 50
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

const supabase = () => createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/** Their date parameters are YYYY/MM/DD — pattern-enforced by the API. */
function chDate(d) {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function istDateStr(ms) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** Last 10 digits — the format-insensitive join between their E.164 and our
 *  free-text phone column. Exact string matching linked 6 of 51 real calls;
 *  this linked 35. */
export function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

/**
 * When the call actually started, in UTC.
 *
 * `date`/`time` are rendered in the account's timezone (IST) and can't be
 * parsed unambiguously. `callHangupTime` is a real UTC timestamp and is
 * present on EVERY status (50/50 across Completed, Rejected, Missed and
 * No Answer), while `callAnswerTime` only exists on answered calls. So we
 * reconstruct the start by subtracting the total duration from the hangup —
 * verified exact: hangup 14:14:00 − 86s = 14:12:34, plus the 5s ring =
 * the 14:12:39 answer time on the same record.
 */
export function callStartMs(rec) {
  const hangup = Date.parse(rec?.callHangupTime || '')
  if (Number.isFinite(hangup)) {
    const total = Number(rec?.totalCallDuration)
    return hangup - (Number.isFinite(total) ? total * 1000 : 0)
  }
  const answer = Date.parse(rec?.callAnswerTime || '')
  return Number.isFinite(answer) ? answer : null
}

/**
 * Did a human pick up?
 *
 * `callStatus === 'Completed'` and the presence of `callAnswerTime` agreed on
 * all 53 records sampled (47/47 answered, 0/6 of Rejected/Missed/No Answer),
 * so either alone is sufficient; requiring both would be brittle if they ever
 * add a status. This is a CARRIER signal — it means the line connected, NOT
 * that we reached the decision maker. That distinction is the whole point of
 * call_outcome, which stays NULL here.
 */
export function isAnswered(rec) {
  if (rec?.callStatus === 'Completed') return true
  return Boolean(rec?.callAnswerTime && String(rec.callAnswerTime).trim())
}

/** One CallHippo record → one crm_outreach_log row. */
export function mapCall(rec, leadByPhone) {
  const startMs = callStartMs(rec)
  const calledAt = startMs ? new Date(startMs).toISOString() : null
  const lead = leadByPhone.get(phoneKey(rec.to)) || null
  const talk = Number(rec.totalCallDuration)

  return {
    outreach_type: 'phone_call',
    call_provider: 'callhippo',
    provider_call_id: rec.callSid || rec._id || null,
    provider_payload: rec,

    phone_number: rec.to || null,
    lead_id: lead?.id ?? null,
    lead_name: lead?.name ?? null,
    firm_name: lead?.firm_name ?? null,

    connected: isAnswered(rec),
    call_duration_seconds: Number.isFinite(talk) ? Math.min(Math.max(talk, 0), 86400) : null,
    called_at: calledAt,
    outreach_date: startMs ? istDateStr(startMs) : null,

    // Left for a human. Their data cannot express our outcome vocabulary.
    call_outcome: null,
    // Neutral. Deriving from a null outcome yields 'no_response', which would
    // drag every reply rate in the app down with calls nobody has judged yet.
    status: 'sent',
    // Unclaimed: one shared CallHippo seat means we cannot know who dialled.
    logged_by: null,

    // A recording link, if CallHippo is configured to produce one. It was
    // empty on all 53 sampled records — recording is off or not on the plan.
    recording_url: rec.recordingUrl?.trim() || null,
    notes: rec.callNotes?.trim() || null,
  }
}

async function fetchPage(token, startDate, endDate, skip) {
  const res = await fetch(`${BASE}/activityfeed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apiToken: token },
    body: JSON.stringify({
      skip: String(skip), limit: String(PAGE), startDate, endDate, apiToken: token,
    }),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    // Same 200-with-an-HTML-shell trap our own apps have: a non-JSON body
    // means we were bounced, not that there are no calls.
    throw new Error(`CallHippo returned non-JSON (HTTP ${res.status}): ${text.slice(0, 160)}`)
  }
  if (json?.error || json?.success === false) {
    throw new Error(typeof json.error === 'string' ? json.error : JSON.stringify(json.error || json))
  }
  return { logs: json?.data?.callLogs || [], hasNext: Boolean(json?.data?.hasNext) }
}

export default async function handler(req, res) {
  if (!requireEnv(res, ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CALLHIPPO_API_TOKEN', 'CRON_SECRET'])) return

  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const dryRun = req.query?.dry_run === '1'
  // DEFAULT TO THE FULL WINDOW, not to "since yesterday".
  //
  // CallHippo deletes call logs older than a month on this plan, so anything
  // this job fails to collect inside 30 days is gone permanently — there is no
  // re-fetch. A narrow daily window would mean one missed night = one lost
  // night. Asking for the whole 29 days every run costs two extra pages and
  // makes ANY single successful run repair every gap the API can still see:
  // the job heals itself as long as it comes back within a month.
  // provider_call_id is unique, so re-reading the same calls inserts nothing.
  const days = Math.min(Number(req.query?.days) || 29, 29)
  const db = supabase()
  // run_key is the logical period, matching the weekly digest's contract —
  // the IST day the sync covered, so repeated runs on one day are legible.
  const runKey = istDateStr(Date.now())

  try {
    // How long since this job last succeeded? A run that returns after a long
    // silence is the signal that the cron stopped — and if the silence is
    // approaching CallHippo's one-month retention, calls have already been
    // lost. Reported in the response and the heartbeat so it is visible
    // wherever anyone looks.
    let daysSinceLastOk = null
    try {
      const { data: prev } = await db
        .from('crm_cron_runs')
        .select('ran_at')
        .eq('job', 'callhippo-sync')
        .eq('status', 'ok')
        .order('ran_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (prev?.ran_at) {
        daysSinceLastOk = Math.floor((Date.now() - Date.parse(prev.ran_at)) / 86400000)
      }
    } catch { /* never block the import on its own diagnostics */ }

    const end = new Date()
    const start = new Date(Date.now() - days * 86400000)

    // 1. Pull every page in the window.
    const records = []
    for (let skip = 0; skip < 2000; skip += PAGE) {
      const { logs, hasNext } = await fetchPage(
        process.env.CALLHIPPO_API_TOKEN, chDate(start), chDate(end), skip
      )
      records.push(...logs)
      if (!hasNext || logs.length === 0) break
    }

    // Inbound calls are not cold calling and must not land in the dial funnel.
    const outgoing = records.filter(r => r.callType === 'Outgoing')

    // 2. Lead lookup by last-10-digits. Paged — this is a counted read.
    const leads = await fetchAllRows(() => db
      .from('crm_leads')
      .select('id, name, firm_name, phone')
      .not('phone', 'is', null)
      .neq('phone', '')
      .order('id'))
    const leadByPhone = new Map()
    for (const l of leads) {
      const k = phoneKey(l.phone)
      // First lead wins on a duplicate number — deterministic via the id sort.
      if (k && !leadByPhone.has(k)) leadByPhone.set(k, l)
    }

    // 3. Skip anything already imported. provider_call_id is uniquely indexed,
    //    so a race would be rejected by the database too — this just avoids
    //    generating writes we know will fail.
    const ids = outgoing.map(r => r.callSid || r._id).filter(Boolean)
    const existing = new Set()
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const { data, error } = await db
        .from('crm_outreach_log')
        .select('provider_call_id')
        .in('provider_call_id', chunk)
      if (error) throw error
      for (const row of data || []) existing.add(row.provider_call_id)
    }

    const rows = outgoing
      .filter(r => !existing.has(r.callSid || r._id))
      .map(r => mapCall(r, leadByPhone))
      .filter(r => r.provider_call_id && r.called_at)

    const summary = {
      window_days: days,
      days_since_last_ok: daysSinceLastOk,
      // True once a gap gets close enough to their retention wall that calls
      // may already have aged out before we ever saw them.
      data_may_have_been_lost: daysSinceLastOk != null && daysSinceLastOk >= 29,
      fetched: records.length,
      outgoing: outgoing.length,
      already_imported: outgoing.length - rows.length,
      to_insert: rows.length,
      matched_to_lead: rows.filter(r => r.lead_id).length,
      unmatched: rows.filter(r => !r.lead_id).length,
      answered: rows.filter(r => r.connected).length,
      with_recording: rows.filter(r => r.recording_url).length,
    }

    if (dryRun) return res.status(200).json({ ok: true, dry_run: true, ...summary })

    let inserted = 0
    if (rows.length) {
      const { data, error } = await db.from('crm_outreach_log').insert(rows).select('id')
      if (error) throw error
      inserted = (data || []).length
    }

    // Heartbeat, same contract as the weekly digest: a run that happened is a
    // row, so silence is detectable.
    await db.from('crm_cron_runs').insert({
      job: 'callhippo-sync',
      run_key: runKey,
      status: 'ok',
      detail: JSON.stringify({ ...summary, inserted }).slice(0, 500),
    })

    return res.status(200).json({ ok: true, ...summary, inserted })
  } catch (err) {
    console.error('[callhippo-sync]', err)
    try {
      await db.from('crm_cron_runs').insert({
        job: 'callhippo-sync',
        run_key: runKey,
        status: 'failed',
        detail: String(err.message || err).slice(0, 500),
      })
    } catch (e) {
      console.error('[callhippo-sync] heartbeat write failed too', e)
    }
    return res.status(500).json({ ok: false, error: String(err.message || err) })
  }
}
