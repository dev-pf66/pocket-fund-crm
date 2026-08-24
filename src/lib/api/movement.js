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
import { istToday, istAddDays, istWeekStart } from '../dateUtils'
import { fetchAllRows } from './core'
import { isForwardMove } from './leads'

const LIVE_STAGES = ['active_conversation', 'meeting_booked']

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
export async function getMovementStats(personId = null, { since, until } = {}) {
  const from = since || currentWeekStart()
  const to = until || istToday()
  // Stage events are timestamps; bound the day range inclusively.
  const fromTs = `${from}T00:00:00+05:30`
  const toTs = `${istAddDays(to, 1)}T00:00:00+05:30`

  const eventsQ = () => {
    let q = supabase
      .from('crm_lead_stage_events')
      .select('lead_id, from_stage, to_stage, changed_by, changed_at')
      .gte('changed_at', fromTs)
      .lt('changed_at', toTs)
    if (personId) q = q.eq('changed_by', personId)
    return q
  }

  const repliesQ = () => {
    let q = supabase
      .from('crm_outreach_log')
      .select('id, logged_by, outreach_date, status')
      .eq('status', 'replied')
      .gte('outreach_date', from)
      .lte('outreach_date', to)
    if (personId) q = q.eq('logged_by', personId)
    return q
  }

  const liveQ = () => {
    let q = supabase
      .from('crm_leads')
      .select('id, assigned_to, stage')
      .in('stage', LIVE_STAGES)
    if (personId) q = q.eq('assigned_to', personId)
    return q
  }

  const [events, replies, live, earliest] = await Promise.all([
    fetchAllRows(eventsQ),
    fetchAllRows(repliesQ),
    fetchAllRows(liveQ),
    supabase.from('crm_lead_stage_events')
      .select('changed_at').order('changed_at', { ascending: true }).limit(1)
  ])

  // One lead moving twice in a week is one lead that moved.
  const advancedLeads = new Set()
  const meetingLeads = new Set()
  for (const e of events) {
    if (e.to_stage === 'meeting_booked') meetingLeads.add(e.lead_id)
    if (isForwardMove(e.from_stage, e.to_stage)) advancedLeads.add(e.lead_id)
  }

  return {
    replies: replies.length,
    meetings: meetingLeads.size,
    advanced: advancedLeads.size,
    live: live.length,
    sampleFrom: earliest?.data?.[0]?.changed_at?.slice(0, 10) || null,
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
  const [current, previous] = await Promise.all([
    getMovementStats(personId, { since: thisStart, until: istToday() }),
    getMovementStats(personId, { since: lastStart, until: istAddDays(thisStart, -1) })
  ])
  return { current, previous }
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
      .gte('changed_at', `${since}T00:00:00+05:30`)),
    fetchAllRows(() => supabase
      .from('crm_outreach_log')
      .select('logged_by')
      .eq('status', 'replied')
      .gte('outreach_date', since)
      .lte('outreach_date', today)),
    fetchAllRows(() => supabase.from('people').select('id, name, is_archived'))
  ])

  const byPerson = new Map()
  const statsFor = (id) => {
    if (!byPerson.has(id)) byPerson.set(id, { advanced: new Set(), meetings: new Set(), replies: 0 })
    return byPerson.get(id)
  }
  for (const e of events) {
    if (!e.changed_by) continue
    const s = statsFor(e.changed_by)
    if (isForwardMove(e.from_stage, e.to_stage)) s.advanced.add(e.lead_id)
    if (e.to_stage === 'meeting_booked') s.meetings.add(e.lead_id)
  }
  for (const r of replies) {
    if (!r.logged_by) continue
    statsFor(r.logged_by).replies += 1
  }

  const nameById = new Map(people.filter(p => !p.is_archived).map(p => [p.id, p.name]))
  return [...byPerson.entries()]
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
}
