/**
 * CRM API — "what moved": the outcome-side metrics that replaced send counts
 * as the headline numbers (Dev, Aug 2026).
 *
 * Sales runs a deliberately low-volume, high-targeting motion now, so
 * "31 to touch today" and "0 touched this week" measured effort at exactly
 * the moment effort stopped being the point. These are the four things that
 * actually indicate progress:
 *
 *   replies    — outreach rows flipped to 'replied' in the window
 *   meetings   — leads that reached meeting_booked in the window
 *   advanced   — leads that moved FORWARD along STAGE_ORDER in the window
 *   live       — leads sitting in active_conversation / meeting_booked now
 *
 * `advanced` and `meetings` read crm_lead_stage_events (migration 040), which
 * only started recording when that shipped — there is no history to backfill,
 * because the previous stage was overwritten on every change. Numbers are
 * therefore meaningful from that date forward.
 */

import { supabase } from '../supabase'
import { istToday, istAddDays, istWeekStart, IST_OFFSET_MS } from '../dateUtils'
import { fetchAllRows } from './core'
import { isForwardMove } from './leads'

const LIVE_STAGES = ['active_conversation', 'meeting_booked']

/** IST calendar day (YYYY-MM-DD) of a timestamptz string, or null. */
function istDayOf(ts) {
  if (!ts) return null
  return new Date(new Date(ts).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** Start of the current IST week (Monday), as YYYY-MM-DD. */
export function currentWeekStart() {
  return istWeekStart(istToday())
}

/**
 * Movement for one person (or the whole team when personId is null) over a
 * window. `since`/`until` are YYYY-MM-DD IST dates; defaults to this week.
 *
 * Returns { replies, meetings, advanced, live, sampleFrom } — sampleFrom is
 * the earliest stage event on record, so the UI can be honest that the
 * history only goes back so far.
 */
export async function getMovementStats(personId = null, { since, until, includeSnapshot = true } = {}) {
  const from = since || currentWeekStart()
  const to = until || istToday()
  // Stage events are timestamps; bound the day range inclusively.
  const fromTs = `${from}T00:00:00+05:30`
  const toTs = `${istAddDays(to, 1)}T00:00:00+05:30`

  // Every paged query carries a total sort: fetchAllRows walks ranges, and
  // without a deterministic order Postgres can skip or repeat rows at a page
  // boundary. This repo has shipped that bug three times.
  const eventsQ = () => {
    let q = supabase
      .from('crm_lead_stage_events')
      .select('lead_id, from_stage, to_stage, changed_by, changed_at')
      .gte('changed_at', fromTs)
      .lt('changed_at', toTs)
      .order('id')
    if (personId) q = q.eq('changed_by', personId)
    return q
  }

  // Keyed on replied_at — when the reply ARRIVED — not outreach_date, which
  // is when the message was sent. A reply to a three-week-old message is this
  // week's win, and counting it against the send week made it invisible.
  // Rows replied to before migration 041 have no replied_at and are excluded;
  // that date was never recorded and can't be recovered.
  const repliesQ = () => {
    let q = supabase
      .from('crm_outreach_log')
      .select('id, logged_by, replied_at, status')
      .eq('status', 'replied')
      .gte('replied_at', fromTs)
      .lt('replied_at', toTs)
      .order('id')
    if (personId) q = q.eq('logged_by', personId)
    return q
  }

  const liveQ = () => {
    let q = supabase
      .from('crm_leads')
      .select('id, assigned_to, stage')
      .in('stage', LIVE_STAGES)
      .order('id')
    if (personId) q = q.eq('assigned_to', personId)
    return q
  }

  // `live` and `earliest` describe the present, not the window, so the
  // previous-week call skips them rather than computing and discarding two
  // extra round-trips on every page load.
  const [events, replies, live, earliest] = await Promise.all([
    fetchAllRows(eventsQ),
    fetchAllRows(repliesQ),
    includeSnapshot ? fetchAllRows(liveQ) : Promise.resolve([]),
    includeSnapshot
      ? supabase.from('crm_lead_stage_events')
          .select('changed_at').order('changed_at', { ascending: true }).limit(1)
      : Promise.resolve({ data: [] })
  ])

  // One lead moving twice in a week is one lead that moved.
  const advancedLeads = new Set()
  const meetingLeads = new Set()
  for (const e of events) {
    const forward = isForwardMove(e.from_stage, e.to_stage)
    // Forward-only: a stalled deal dragged back from `client` to
    // meeting_booked is a loss, not a meeting booked this week.
    if (forward && e.to_stage === 'meeting_booked') meetingLeads.add(e.lead_id)
    if (forward) advancedLeads.add(e.lead_id)
  }

  return {
    replies: replies.length,
    meetings: meetingLeads.size,
    advanced: advancedLeads.size,
    live: live.length,
    // IST calendar day, like every other date here. Slicing the raw UTC
    // string reported "tracked since Aug 24" for a row created 02:10 IST on
    // Aug 25, and tripped the first-week delta guard a day early.
    sampleFrom: istDayOf(earliest?.data?.[0]?.changed_at),
    from,
    to
  }
}

/**
 * This week vs last week, for the delta arrows on the headline cards.
 */
export async function getMovementWeekOverWeek(personId = null) {
  const thisStart = currentWeekStart()
  const lastStart = istAddDays(thisStart, -7)
  const today = istToday()

  // Compare like with like. The current week is partial — on Tuesday it's two
  // days old — so measuring it against a FULL previous week made every
  // Monday and Tuesday render a red decline for everyone, regardless of pace.
  // The previous window is truncated to the same day-of-week offset.
  const daysIn = Math.round(
    (new Date(`${today}T12:00:00Z`) - new Date(`${thisStart}T12:00:00Z`)) / 86400000
  )
  const prevUntil = istAddDays(lastStart, daysIn)

  const [current, previous] = await Promise.all([
    getMovementStats(personId, { since: thisStart, until: today }),
    getMovementStats(personId, { since: lastStart, until: prevUntil, includeSnapshot: false })
  ])
  // comparableFrom: the delta is only honest once tracking covers the whole
  // previous window. Consumers blank the arrows until then.
  return { current, previous, comparableFrom: lastStart }
}

/**
 * Per-person movement for the admin strip — who moved deals, not who sent
 * most. Sorted by leads advanced, then meetings, then replies.
 */
export async function getTeamMovementThisWeek() {
  const since = currentWeekStart()
  const today = istToday()

  const [events, replies, people] = await Promise.all([
    fetchAllRows(() => supabase
      .from('crm_lead_stage_events')
      .select('lead_id, from_stage, to_stage, changed_by')
      .gte('changed_at', `${since}T00:00:00+05:30`)
      .order('id')),
    fetchAllRows(() => supabase
      .from('crm_outreach_log')
      .select('logged_by')
      .eq('status', 'replied')
      .gte('replied_at', `${since}T00:00:00+05:30`)
      .lt('replied_at', `${istAddDays(today, 1)}T00:00:00+05:30`)
      .order('id')),
    fetchAllRows(() => supabase.from('people').select('id, name, is_archived').order('id'))
  ])

  const unattributedLeads = new Set()
  const byPerson = new Map()
  const statsFor = (id) => {
    if (!byPerson.has(id)) byPerson.set(id, { advanced: new Set(), meetings: new Set(), replies: 0 })
    return byPerson.get(id)
  }
  for (const e of events) {
    // Auto-advances from a reply with no logged_by have no actor. Counting
    // them nowhere made the strip fail to add up to the team headline.
    if (!e.changed_by) {
      // A Set of lead ids, not a tally — every other row de-dupes ("a lead
      // that moves twice in a week is one lead"), and the whole point of this
      // row is that the strip reconciles with the team headline. Every move
      // made through the HTTP API lands here (changed_by is null for a
      // machine caller), so a lead PATCHed twice would otherwise read as 2.
      if (isForwardMove(e.from_stage, e.to_stage)) unattributedLeads.add(e.lead_id)
      continue
    }
    const s = statsFor(e.changed_by)
    const forward = isForwardMove(e.from_stage, e.to_stage)
    if (forward) s.advanced.add(e.lead_id)
    if (forward && e.to_stage === 'meeting_booked') s.meetings.add(e.lead_id)
  }
  for (const r of replies) {
    if (!r.logged_by) continue
    statsFor(r.logged_by).replies += 1
  }

  const nameById = new Map(people.filter(p => !p.is_archived).map(p => [p.id, p.name]))
  const rows = [...byPerson.entries()]
    .filter(([id]) => nameById.has(id))
    .map(([id, s]) => ({
      personId: id,
      name: nameById.get(id),
      advanced: s.advanced.size,
      meetings: s.meetings.size,
      replies: s.replies
    }))
    .filter(r => r.advanced || r.meetings || r.replies)
    .sort((a, b) => b.advanced - a.advanced || b.meetings - a.meetings || b.replies - a.replies)

  if (unattributedLeads.size) {
    rows.push({ personId: 'unattributed', name: 'Unattributed', advanced: unattributedLeads.size, meetings: 0, replies: 0 })
  }
  return rows
}
