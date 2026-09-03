/**
 * CRM API — cold calls.
 *
 * Calls live in crm_outreach_log, ONE ROW PER DIAL, so every existing daily
 * target, streak, weekly digest and "My Week" count keeps working without
 * knowing calls exist (Dev's call, Sept 2026: dials count toward the goal).
 * What makes them calls is outreach_type='phone_call' plus the call_* columns
 * from migration 044. The funnel that matters — dials → pickups →
 * conversations → meetings — is derived from call_outcome, whose vocabulary
 * and predicates live in src/lib/callOutcomes.js.
 *
 * PAGING: this table is about to become the highest-volume in the CRM
 * (~20 dials × 5 callers × 5 days ≈ 500 rows/week from calls alone). Every
 * list read here goes through fetchAllRows with a total sort and a date
 * bound. PostgREST truncates a plain select at 1000 rows with no error and
 * this repo has shipped that bug three times.
 */

import { supabase } from '../supabase'
import { istToday, istAddDays, IST_OFFSET_MS } from '../dateUtils'
import { cacheClear, fireTTEvent, istDateStr, fetchAllRows } from './core'
import { advanceLeadStage } from './leads'
import { promoteOutreachToLead } from './outreach'
import { logActivityManual } from './misc'
import { statusForOutcome, isPickup, isConversation, summarizeCalls, rate } from '../callOutcomes'

/**
 * How many dials at one contact before the queue stops offering them. Not a
 * hard block — exhausted leads are still reachable in their own section — but
 * past this the marginal dial is worth less than a fresh name.
 */
export const MAX_CALL_ATTEMPTS = 6

/**
 * Outcomes that take a lead out of the queue for good. do_not_call has its own
 * column on crm_leads (a legal-ish flag, not a preference) and is filtered in
 * SQL; these two are filtered client-side off the call history.
 */
const TERMINAL_OUTCOMES = new Set(['bad_number', 'not_interested'])

/** Base select for anything that renders a call row. */
const CALL_COLUMNS = `
  id, lead_id, lead_name, firm_name, phone_number, outreach_date, called_at,
  call_outcome, connected, call_duration_seconds, attempt_number, callback_at,
  recording_url, notes, status, logged_by, created_at
`

/** IST clock hour (0-23) of a timestamptz, or null. */
export function istHourOf(ts) {
  if (!ts) return null
  return new Date(new Date(ts).getTime() + IST_OFFSET_MS).getUTCHours()
}

/** IST calendar day (YYYY-MM-DD) of a timestamptz, or null. */
function istDayOf(ts) {
  if (!ts) return null
  return new Date(new Date(ts).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

// ============================================================================
// LOGGING A DIAL
// ============================================================================

/**
 * Log one dial.
 *
 * `call` takes: { lead_id?, lead_name, firm_name?, phone_number?, call_outcome,
 * call_duration_seconds?, notes?, callback_at?, recording_url?, called_at? }.
 *
 * Everything derived — status, connected, attempt_number, replied_at — is
 * computed here so no caller can log a row that disagrees with the funnel.
 */
export async function logCall(call, currentPersonId, currentPersonName = null) {
  const outcome = call.call_outcome || null
  const status = statusForOutcome(outcome)
  const calledAt = call.called_at || new Date().toISOString()

  const row = {
    lead_id: call.lead_id ?? null,
    lead_name: call.lead_name || null,
    firm_name: call.firm_name || null,
    phone_number: call.phone_number || null,
    outreach_type: 'phone_call',
    // The IST calendar day of the dial — this is what the daily target,
    // the streak and the digest all bucket on.
    outreach_date: call.outreach_date || istDateStr(new Date(calledAt).getTime()),
    called_at: calledAt,
    call_outcome: outcome,
    // An explicit connected wins (a provider webhook knows answered/not from
    // the carrier); otherwise derive it from the outcome.
    connected: typeof call.connected === 'boolean' ? call.connected : isPickup(outcome),
    call_duration_seconds: call.call_duration_seconds ?? null,
    callback_at: call.callback_at || null,
    recording_url: call.recording_url || null,
    notes: call.notes || null,
    status,
    call_provider: call.call_provider || 'callhippo',
    provider_call_id: call.provider_call_id || null,
    logged_by: currentPersonId ?? null,
    attempt_number: await nextAttemptNumber(call),
    // outreach_date is the day we DIALLED. A reply arriving weeks later must
    // not be bucketed into the send week — same rule as email (migration 041).
    ...(status === 'replied' ? { replied_at: calledAt } : {}),
  }

  const { data, error } = await supabase
    .from('crm_outreach_log')
    .insert([row])
    .select()
    .single()
  if (error) throw error

  await applyCallSideEffects(data, currentPersonId)

  if (currentPersonName && data) {
    const who = data.lead_name || data.phone_number || 'unknown contact'
    try {
      await logActivityManual({
        user_id: currentPersonId,
        user_name: currentPersonName,
        action_type: 'outreach_logged',
        description: `${currentPersonName} called ${who}${data.firm_name ? ' at ' + data.firm_name : ''} — ${String(outcome || 'logged').replace(/_/g, ' ')}`,
        entity_type: 'outreach',
        entity_id: data.id,
        entity_name: who,
        metadata: {
          outreach_type: 'phone_call',
          call_outcome: outcome,
          connected: data.connected,
          attempt_number: data.attempt_number,
        },
      })
    } catch (e) {
      console.error('Failed to log call activity:', e)
    }
  }

  // Same contract as logOutreach: the dispatcher treats the payload AS the
  // outreach row, so send the raw row rather than wrapping it.
  fireTTEvent('outreach_logged', data)

  cacheClear('dashboard')
  cacheClear('calls')
  return data
}

/**
 * Nth dial at this contact. Counted from prior call rows on the same lead, or
 * — for a lead-less dial — the same phone number. Cheap head-count query, no
 * rows over the wire.
 */
async function nextAttemptNumber({ lead_id, phone_number }) {
  try {
    let q = supabase
      .from('crm_outreach_log')
      .select('id', { count: 'exact', head: true })
      .eq('outreach_type', 'phone_call')
    if (lead_id) q = q.eq('lead_id', lead_id)
    else if (phone_number) q = q.eq('phone_number', phone_number)
    else return 1
    const { count, error } = await q
    if (error) throw error
    return (count || 0) + 1
  } catch (e) {
    // A failed count must not block the log — the dial happened either way.
    console.error('attempt_number lookup failed, defaulting to 1', e)
    return 1
  }
}

/**
 * Everything a call outcome changes outside its own row. Never throws — the
 * dial is already saved, and a side-effect failure must not surface to the
 * caller as "failed to log call" mid-session.
 */
async function applyCallSideEffects(row, currentPersonId = null) {
  const personId = currentPersonId ?? row.logged_by ?? null
  const outcome = row.call_outcome

  try {
    // Someone who asks not to be called again must never resurface in the
    // queue. The flag is the only thing the queue filter can read.
    if (outcome === 'do_not_call' && row.lead_id) {
      await supabase.from('crm_leads').update({ do_not_call: true }).eq('id', row.lead_id)
      cacheClear('leads')
    }

    // A callback is a promise with a time on it. next_follow_up_date is a
    // DATE, so it gets the IST day; the exact time lives on the call row and
    // the Call Mode queue reads callback_at directly.
    if (row.callback_at && row.lead_id) {
      await supabase
        .from('crm_leads')
        .update({
          next_follow_up_date: istDayOf(row.callback_at),
          follow_up_note: row.notes || 'Callback requested on a cold call',
        })
        .eq('id', row.lead_id)
      cacheClear('leads')
    }

    // Pipeline movement. Forward-only via advanceLeadStage, which refuses to
    // regress a lead and never touches client/passed.
    if (outcome === 'meeting_booked') {
      if (row.lead_id) await advanceLeadStage(row.lead_id, 'meeting_booked', personId)
      else if (row.lead_name) await promoteOutreachToLead(row, personId, { stage: 'meeting_booked' })
    } else if (isConversation(outcome)) {
      // We reached them and they engaged — including a flat no. They responded.
      if (row.lead_id) await advanceLeadStage(row.lead_id, 'responded', personId)
      else if (row.lead_name) await promoteOutreachToLead(row, personId, { stage: 'responded' })
    }
    cacheClear('leads')
    cacheClear('dashboard')
  } catch (e) {
    console.error('Call side-effects failed (the dial itself was saved):', e)
  }
}

/**
 * Patch a logged call — used to attach a recording after the fact, fix a
 * mis-tapped outcome, or add notes. Re-derives status/connected when the
 * outcome changes so the row can never drift out of step with the funnel.
 */
export async function updateCall(id, updates, currentPersonId = null) {
  const patch = { ...updates }

  if (Object.prototype.hasOwnProperty.call(updates, 'call_outcome')) {
    const outcome = updates.call_outcome
    patch.status = statusForOutcome(outcome)
    if (typeof updates.connected !== 'boolean') patch.connected = isPickup(outcome)
    // Re-tapping an outcome to a conversation stamps the reply now; correcting
    // it back to a non-reply clears the stamp so it stops counting as one.
    patch.replied_at = patch.status === 'replied'
      ? (updates.replied_at || new Date().toISOString())
      : null
  }

  const { data, error } = await supabase
    .from('crm_outreach_log')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error

  if (Object.prototype.hasOwnProperty.call(updates, 'call_outcome')) {
    await applyCallSideEffects(data, currentPersonId)
  }
  cacheClear('calls')
  return data
}

// ============================================================================
// READING CALLS
// ============================================================================

/**
 * Call rows over a window, newest first. `personId` null = whole team
 * (RLS lets admins through).
 */
export async function getCallLog({ daysBack = 30, outcome = null, leadId = null } = {}, personId = null) {
  const since = istAddDays(istToday(), -daysBack)
  return fetchAllRows(() => {
    let q = supabase
      .from('crm_outreach_log')
      .select(`${CALL_COLUMNS}, lead:crm_leads(id, name, firm_name, stage), logged_by_person:logged_by(id, name)`)
      .eq('outreach_type', 'phone_call')
      .gte('outreach_date', since)
      // Total sort: paging an ordered query with ties can skip or duplicate
      // rows at a page boundary.
      .order('outreach_date', { ascending: false })
      .order('id', { ascending: false })
    if (outcome) q = q.eq('call_outcome', outcome)
    if (leadId) q = q.eq('lead_id', leadId)
    if (personId) q = q.eq('logged_by', personId)
    return q
  })
}

/**
 * The lightweight slice used by every metric on the page: no joins, no
 * message bodies, just what the funnel and the scorecard need.
 */
async function getCallMetricRows(daysBack, personId = null) {
  const since = istAddDays(istToday(), -daysBack)
  return fetchAllRows(() => {
    let q = supabase
      .from('crm_outreach_log')
      .select('id, logged_by, lead_id, outreach_date, called_at, call_outcome, connected, call_duration_seconds, attempt_number')
      .eq('outreach_type', 'phone_call')
      .gte('outreach_date', since)
      .order('id')
    if (personId) q = q.eq('logged_by', personId)
    return q
  })
}

// ============================================================================
// THE FUNNEL — how strong, how effective
// ============================================================================

/**
 * Cold call funnel over a window, plus the two breakdowns that tell you what
 * to change: outcome mix, and dials-vs-pickups by hour of the IST day.
 *
 * Also returns `attempts` — pickup rate by attempt number — which is the
 * evidence for whether the 6th dial is worth making.
 */
export async function getCallFunnel({ daysBack = 30, personId = null } = {}) {
  const rows = await getCallMetricRows(daysBack, personId)
  const summary = summarizeCalls(rows)

  // Time of day. Calling US buyers from IST makes the call window the single
  // biggest lever available, so it gets first-class treatment.
  const hours = new Map()
  for (const r of rows) {
    const h = istHourOf(r.called_at)
    if (h == null) continue
    if (!hours.has(h)) hours.set(h, { hour: h, dials: 0, pickups: 0, conversations: 0 })
    const b = hours.get(h)
    b.dials += 1
    if (r.connected === true || (r.connected == null && isPickup(r.call_outcome))) b.pickups += 1
    if (isConversation(r.call_outcome)) b.conversations += 1
  }
  const byHour = [...hours.values()]
    .sort((a, b) => a.hour - b.hour)
    .map(b => ({ ...b, pickupRate: rate(b.pickups, b.dials) }))

  // Does dialling someone a 5th time still pay? Only the data can say.
  const attemptBuckets = new Map()
  for (const r of rows) {
    const n = r.attempt_number || 1
    const key = n >= 6 ? 6 : n
    if (!attemptBuckets.has(key)) attemptBuckets.set(key, { attempt: key, dials: 0, pickups: 0, conversations: 0 })
    const b = attemptBuckets.get(key)
    b.dials += 1
    if (r.connected === true || (r.connected == null && isPickup(r.call_outcome))) b.pickups += 1
    if (isConversation(r.call_outcome)) b.conversations += 1
  }
  const attempts = [...attemptBuckets.values()]
    .sort((a, b) => a.attempt - b.attempt)
    .map(b => ({ ...b, pickupRate: rate(b.pickups, b.dials), label: b.attempt >= 6 ? '6+' : String(b.attempt) }))

  // Daily dial counts, so the page can draw the volume trend under the funnel.
  const daily = new Map()
  for (const r of rows) {
    if (!r.outreach_date) continue
    if (!daily.has(r.outreach_date)) daily.set(r.outreach_date, { date: r.outreach_date, dials: 0, pickups: 0, conversations: 0 })
    const d = daily.get(r.outreach_date)
    d.dials += 1
    if (r.connected === true || (r.connected == null && isPickup(r.call_outcome))) d.pickups += 1
    if (isConversation(r.call_outcome)) d.conversations += 1
  }

  return {
    ...summary,
    // byOutcome is a Map from summarizeCalls; hand the page a sorted array too.
    outcomeRows: [...summary.byOutcome.entries()]
      .map(([outcome, count]) => ({ outcome, count, share: rate(count, summary.dials) }))
      .sort((a, b) => b.count - a.count),
    byHour,
    attempts,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    daysBack,
  }
}

// ============================================================================
// THE CALLERS — consistent? effective?
// ============================================================================

/** Weekdays (Mon-Fri) in an inclusive IST date range — the consistency denominator. */
export function weekdaysBetween(fromDate, toDate) {
  let count = 0
  let cursor = fromDate
  // Bounded by the window the caller asked for; guards against a reversed range.
  for (let i = 0; i < 400 && cursor <= toDate; i += 1) {
    const day = new Date(`${cursor}T12:00:00Z`).getUTCDay()
    if (day !== 0 && day !== 6) count += 1
    cursor = istAddDays(cursor, 1)
  }
  return count
}

/**
 * Per-caller scorecard: consistency (did they show up) and effectiveness (did
 * it work), side by side. This is the whole point of the tab — a caller who
 * dials 200 times with a 2% pickup rate and a caller who dials 60 with 30%
 * are different problems and need different conversations.
 *
 * Consistency is active days over WEEKDAYS in the window, not calendar days:
 * nobody is expected to cold call on a Sunday, and counting weekends made
 * everyone look 30% inconsistent by arithmetic.
 */
export async function getCallerScorecard({ daysBack = 30 } = {}) {
  const today = istToday()
  const since = istAddDays(today, -daysBack)

  const [rows, people] = await Promise.all([
    getCallMetricRows(daysBack, null),
    fetchAllRows(() => supabase.from('people').select('id, name, is_archived').order('id')),
  ])

  const expectedDays = weekdaysBetween(since, today)
  const byPerson = new Map()
  for (const r of rows) {
    if (!r.logged_by) continue
    if (!byPerson.has(r.logged_by)) byPerson.set(r.logged_by, { rows: [], days: new Set() })
    const p = byPerson.get(r.logged_by)
    p.rows.push(r)
    if (r.outreach_date) p.days.add(r.outreach_date)
  }

  const nameById = new Map(people.filter(p => !p.is_archived).map(p => [p.id, p.name]))

  return [...byPerson.entries()]
    .filter(([id]) => nameById.has(id))
    .map(([id, p]) => {
      const s = summarizeCalls(p.rows)
      const activeDays = p.days.size
      return {
        personId: id,
        name: nameById.get(id),
        // Consistency
        activeDays,
        expectedDays,
        consistency: rate(activeDays, expectedDays),
        dialsPerActiveDay: activeDays > 0 ? s.dials / activeDays : 0,
        // Effectiveness
        dials: s.dials,
        pickups: s.pickups,
        conversations: s.conversations,
        meetings: s.meetings,
        pickupRate: s.pickupRate,
        conversationRate: s.conversationRate,
        dialsPerMeeting: s.dialsPerMeeting,
        avgTalkSeconds: s.avgTalkSeconds,
      }
    })
    // Conversations first: the thing we manage on, not the thing that's easy
    // to produce. Dials are the tiebreak, never the headline.
    .sort((a, b) => b.conversations - a.conversations || b.pickups - a.pickups || b.dials - a.dials)
}

// ============================================================================
// THE CALL QUEUE
// ============================================================================

/**
 * Callbacks that are due — promised times that have arrived. These jump the
 * queue: a missed callback is the most expensive thing on the page, because
 * it's the one contact who already agreed to talk.
 */
export async function getCallbacksDue(personId = null, { includeUpcoming = false } = {}) {
  const nowIso = new Date().toISOString()
  const rows = await fetchAllRows(() => {
    let q = supabase
      .from('crm_outreach_log')
      .select(`${CALL_COLUMNS}, lead:crm_leads(id, name, firm_name, phone, stage, do_not_call)`)
      .eq('outreach_type', 'phone_call')
      .not('callback_at', 'is', null)
      .order('callback_at', { ascending: true })
      .order('id')
    if (!includeUpcoming) q = q.lte('callback_at', nowIso)
    if (personId) q = q.eq('logged_by', personId)
    return q
  })
  // A callback is spent once we've dialled them again after it was set.
  const laterCalls = new Set()
  const leadIds = [...new Set(rows.map(r => r.lead_id).filter(Boolean))]
  if (leadIds.length) {
    const followUps = await fetchAllRows(() => supabase
      .from('crm_outreach_log')
      .select('lead_id, called_at')
      .eq('outreach_type', 'phone_call')
      .in('lead_id', leadIds)
      .order('id'))
    for (const r of rows) {
      const spent = followUps.some(f =>
        f.lead_id === r.lead_id && f.called_at && r.called_at && f.called_at > r.called_at)
      if (spent) laterCalls.add(r.id)
    }
  }
  return rows.filter(r => !laterCalls.has(r.id) && !r.lead?.do_not_call)
}

/**
 * The dial list. Leads with a phone number that aren't do-not-call, ranked by
 * what is worth dialling next:
 *
 *   1. a callback whose time has come
 *   2. never called
 *   3. longest since the last attempt
 *
 * Leads whose last outcome was terminal (dead number, flat no) and leads past
 * MAX_CALL_ATTEMPTS are split out rather than dropped — they're still visible,
 * just not in the working queue.
 */
export async function getCallQueue(personId = null, { limit = 50, daysBackHistory = 180 } = {}) {
  const leads = await fetchAllRows(() => {
    let q = supabase
      .from('crm_leads')
      .select('id, name, firm_name, phone, stage, lead_type, notes, next_follow_up_date, follow_up_note, assigned_to, do_not_call, linkedin_url')
      .not('phone', 'is', null)
      .neq('phone', '')
      .eq('do_not_call', false)
      // Cold calling works the top of the funnel. Won and dead leads are out.
      .not('stage', 'in', '("client","passed")')
      .order('id')
    if (personId) q = q.eq('assigned_to', personId)
    return q
  })

  if (leads.length === 0) return { queue: [], callbacks: [], exhausted: [], parked: [] }

  const since = istAddDays(istToday(), -daysBackHistory)
  const history = await fetchAllRows(() => supabase
    .from('crm_outreach_log')
    .select('lead_id, called_at, outreach_date, call_outcome, callback_at, attempt_number, notes')
    .eq('outreach_type', 'phone_call')
    .gte('outreach_date', since)
    .not('lead_id', 'is', null)
    .order('id'))

  const byLead = new Map()
  for (const h of history) {
    if (!byLead.has(h.lead_id)) byLead.set(h.lead_id, [])
    byLead.get(h.lead_id).push(h)
  }

  const now = Date.now()
  const enriched = leads.map(lead => {
    const calls = (byLead.get(lead.id) || [])
      .slice()
      // called_at can be null on rows imported before migration 044 backfilled
      // it; fall back to the date so ordering stays deterministic.
      .sort((a, b) => String(a.called_at || a.outreach_date).localeCompare(String(b.called_at || b.outreach_date)))
    const last = calls[calls.length - 1] || null
    // calls is sorted oldest → newest, so the last row IS the most recent dial.
    // A callback is therefore open exactly when the most recent dial set one:
    // anything dialled afterwards has already superseded it.
    const openCallback = last?.callback_at || null
    return {
      ...lead,
      attempts: calls.length,
      lastCall: last,
      lastOutcome: last?.call_outcome || null,
      lastCalledAt: last?.called_at || last?.outreach_date || null,
      callbackAt: openCallback,
      callbackDue: !!openCallback && new Date(openCallback).getTime() <= now,
    }
  })

  const callbacks = enriched
    .filter(l => l.callbackDue)
    .sort((a, b) => String(a.callbackAt).localeCompare(String(b.callbackAt)))

  const rest = enriched.filter(l => !l.callbackDue)
  const exhausted = rest.filter(l => l.attempts >= MAX_CALL_ATTEMPTS && !TERMINAL_OUTCOMES.has(l.lastOutcome))
  const parked = rest.filter(l => TERMINAL_OUTCOMES.has(l.lastOutcome))

  const queue = rest
    .filter(l => l.attempts < MAX_CALL_ATTEMPTS && !TERMINAL_OUTCOMES.has(l.lastOutcome))
    .sort((a, b) => {
      // Never called beats called — a fresh name outperforms a 4th attempt.
      if (!a.lastCalledAt && b.lastCalledAt) return -1
      if (a.lastCalledAt && !b.lastCalledAt) return 1
      if (!a.lastCalledAt && !b.lastCalledAt) return a.id - b.id
      // Then coldest first.
      return String(a.lastCalledAt).localeCompare(String(b.lastCalledAt))
    })
    .slice(0, limit)

  return { queue, callbacks, exhausted, parked }
}

/**
 * Today's dial count for one person — the number the Call Mode header counts
 * against their daily target. head:true, so no rows cross the wire.
 */
export async function getTodayCallCount(personId) {
  if (!personId) return 0
  const { count, error } = await supabase
    .from('crm_outreach_log')
    .select('id', { count: 'exact', head: true })
    .eq('outreach_type', 'phone_call')
    .eq('logged_by', personId)
    .eq('outreach_date', istToday())
  if (error) throw error
  return count || 0
}

/** Flag / unflag a lead as do-not-call. */
export async function setDoNotCall(leadId, value = true) {
  const { data, error } = await supabase
    .from('crm_leads')
    .update({ do_not_call: !!value })
    .eq('id', leadId)
    .select()
    .single()
  if (error) throw error
  cacheClear('leads')
  return data
}
