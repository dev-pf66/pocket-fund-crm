/**
 * CRM API — Today tab: per-user daily work queue, follow-up cadence,
 * escalations, and the header counters/rollups.
 */

import { supabase } from '../supabase'
import { istAddDays, istWeekStart } from '../dateUtils'
import { cacheClear, istDateStr, getDaysBetween, fetchAllRows } from './core'
import { logActivity, calculateStaleness, updateLead } from './leads'
import { runBulk } from '../bulkActions'
import { advanceFollowUpCadence, clearFollowUp, snoozeFollowUp } from './followups'
import { getCRMSettings } from './misc'

// ============================================================================
// TODAY TAB API
// ============================================================================
// Per-user daily work queue (src/pages/Today.jsx). Every fetch is scoped to
// the current person via assigned_to (RLS applies on top as the signed-in
// user); admins pass null where noted to see everything. Staleness
// thresholds come from crm_settings with 3/7/14 fallbacks.

// Ranking weights: warm/responded leads outrank active conversations going
// quiet, then cold-outreach continuations, then new leads. Stages absent
// here (client, passed, reach_out_later) never enter the queue.
export const TODAY_STAGE_WEIGHTS = {
  warm_lead: 5,
  responded: 5,
  active_conversation: 4,
  meeting_booked: 3,
  cold_outreach: 2,
  new_lead: 1
}

const TODAY_QUEUE_STAGES = Object.keys(TODAY_STAGE_WEIGHTS)
const TODAY_ENGAGED_STAGES = ['responded', 'warm_lead', 'active_conversation', 'meeting_booked']

// Today only surfaces what's live: activity in the last 2 weeks, or
// follow-ups due in the next 2 weeks. Older neglected leads stop flooding
// the queue and pinging notifications — they're still fully there in
// Pipeline, just not shoved in front of a rep every morning.
const RECENT_WINDOW_DAYS = 14

/**
 * Staleness thresholds for the Today tab. Reads crm_settings (the same
 * source calculateStaleness uses) and falls back to 3/7/14 if the settings
 * row is unreachable, so the tab still ranks sensibly.
 * Returns { cold, warm, active, raw } — raw is a settings-shaped object
 * safe to hand to StalenessBadge/calculateStaleness.
 */
export async function getTodayThresholds() {
  try {
    const s = await getCRMSettings()
    return {
      cold: s.cold_outreach_threshold || 3,
      warm: s.warm_lead_threshold || 7,
      active: s.active_conversation_threshold || 14,
      raw: s
    }
  } catch (e) {
    console.error('getTodayThresholds: settings unavailable, using 3/7/14 fallback', e)
    const raw = { cold_outreach_threshold: 3, warm_lead_threshold: 7, active_conversation_threshold: 14 }
    return { cold: 3, warm: 7, active: 14, raw }
  }
}

/** Days since the lead's last activity (creation date if never touched). */
export function daysStaleFor(lead) {
  const ref = lead.last_activity_date || lead.created_at
  if (!ref) return 0
  return getDaysBetween(new Date(ref), new Date())
}

/**
 * Today-queue rank: stage weight × days-stale × lead_score.
 * days-stale and lead_score floor at 1 so a missing score or same-day
 * activity never zeroes out an otherwise urgent lead.
 */
export function todayRank(lead) {
  const weight = TODAY_STAGE_WEIGHTS[lead.stage] || 0
  return weight * Math.max(daysStaleFor(lead), 1) * Math.max(lead.lead_score || 0, 1)
}

/**
 * Today's touches: the current user's assigned leads, ranked by todayRank,
 * capped at `limit` (25 — finishable, not a wall). Leads already touched
 * today (on any surface) are excluded, which is also what makes
 * "pull 25 more" a simple refetch. Returns { leads, total } where total is
 * the full untouched pool size for the header counter.
 */
export async function getTodayQueue(personId, { limit = 25 } = {}) {
  if (!personId) return { leads: [], total: 0 }
  const today = istDateStr()

  const { data, error } = await supabase
    .from('crm_leads')
    .select('*')
    .eq('assigned_to', personId)
    .in('stage', TODAY_QUEUE_STAGES)
  if (error) throw error

  const candidates = (data || []).filter(lead => {
    // Touched today already (any surface) — done, not due.
    if (lead.last_activity_date && istDateStr(new Date(lead.last_activity_date).getTime()) === today) return false
    // Gone quiet longer than the recent window — still fully reachable via
    // Pipeline, just not surfaced here to nag about leads sitting for months.
    if (daysStaleFor(lead) > RECENT_WINDOW_DAYS) return false
    return true
  })

  candidates.sort((a, b) => {
    const diff = todayRank(b) - todayRank(a)
    if (diff !== 0) return diff
    // Ties (mostly unscored new leads): newest first.
    return (b.created_at || '').localeCompare(a.created_at || '')
  })

  return { leads: candidates.slice(0, limit), total: candidates.length }
}

/**
 * One-tap "✓ Touched": logs a note activity (which also stamps
 * last_activity_date via logActivity) so the lead drops out of the queue
 * and the touch shows up in every activity-driven metric.
 *
 * If the lead is running a follow-up cadence, the touch also rolls it to its
 * next step — that's what makes a cadence self-sustaining instead of
 * something you re-arm by hand after every reach-out.
 */
export async function markLeadTouched(lead, currentPersonId, note = '', { source = 'Today tab' } = {}) {
  const trimmed = (note || '').trim()
  const activity = await logActivity(lead.id, {
    activity_type: 'note',
    // `source` names the surface in the audit trail. The Pipeline board logs
    // touches too now, and "Touched (Today tab)" on a lead nobody opened in
    // Today would be a lie in that lead's history.
    notes: trimmed ? `Touched — ${trimmed}` : `Touched (${source})`
  }, currentPersonId)

  if (lead.follow_up_cadence?.offsets?.length) {
    await advanceFollowUpCadence(lead, currentPersonId).catch(err =>
      console.error('Cadence advance failed (touch was logged):', err)
    )
  } else if (lead.next_follow_up_date) {
    // One-off reminder, now spent.
    await clearFollowUp(lead.id, currentPersonId).catch(err =>
      console.error('Follow-up clear failed (touch was logged):', err)
    )
  }
  return activity
}

/**
 * Follow-ups due: assigned engaged leads (responded/warm/active/meeting)
 * hitting the day-3/7/14 cadence marks (thresholds from settings), plus any
 * non-terminal lead with next_follow_up_date within the next
 * RECENT_WINDOW_DAYS (overdue, today, or coming up) — the forward-looking
 * half of the window, so a rep sees what's coming, not just what's slipped.
 * A "circle back in a month" scheduled beyond that horizon isn't dropped —
 * it just isn't due YET, so it correctly waits until it's within 2 weeks out.
 * A follow-up missed more than RECENT_WINDOW_DAYS ago also drops off —
 * mirrors the notification bell's cap so Today doesn't nag about a reminder
 * set months ago and forgotten (still on the lead, still in Pipeline).
 * Sorted by next_follow_up_date (overdue-oldest first); cadence-mark-only
 * entries (no explicit date) sort after, most-stale first.
 */
export async function getFollowUpsDue(personId) {
  if (!personId) return []
  const t = await getTodayThresholds()
  const today = istDateStr()
  const horizon = istAddDays(today, RECENT_WINDOW_DAYS)
  const floor = istAddDays(today, -RECENT_WINDOW_DAYS)

  const { data, error } = await supabase
    .from('crm_leads')
    .select('*')
    .eq('assigned_to', personId)
    .not('stage', 'in', '(passed,client)')
  if (error) throw error

  const marks = new Set([t.cold, t.warm, t.active])
  return (data || [])
    .filter(lead => {
      if (lead.next_follow_up_date) return lead.next_follow_up_date <= horizon && lead.next_follow_up_date >= floor
      if (!TODAY_ENGAGED_STAGES.includes(lead.stage)) return false
      return marks.has(daysStaleFor(lead))
    })
    .sort((a, b) => {
      if (a.next_follow_up_date && b.next_follow_up_date) {
        return a.next_follow_up_date.localeCompare(b.next_follow_up_date)
      }
      if (a.next_follow_up_date) return -1
      if (b.next_follow_up_date) return 1
      return daysStaleFor(b) - daysStaleFor(a)
    })
}

/**
 * Escalations to Dev — high bar, capped at 10:
 * - active_conversation silent past the active threshold (>14d), or
 * - budget discussed / expected close date set on an engaged lead that's
 *   stalling past the warm threshold.
 * personId scopes to one owner's book; null aggregates across all users
 * (Dev/admin view — RLS lets admins through).
 */
export async function getEscalations(personId = null, { limit = 10 } = {}) {
  const t = await getTodayThresholds()

  // Paged: team-wide this is every open lead, and the sort below runs over
  // the whole set — a truncated page wouldn't just shorten the list, it would
  // hand back the wrong top 10.
  const data = await fetchAllRows(() => {
    let q = supabase
      .from('crm_leads')
      .select('*')
      .not('stage', 'in', '(passed,client)')
    if (personId) q = q.eq('assigned_to', personId)
    return q
  })

  const escalations = data.filter(lead => {
    const days = daysStaleFor(lead)
    if (lead.stage === 'active_conversation' && days > t.active) return true
    const dealSignals = lead.budget_discussed || lead.expected_close_date
    if (dealSignals && days > t.warm && TODAY_ENGAGED_STAGES.includes(lead.stage)) return true
    return false
  })

  escalations.sort((a, b) => daysStaleFor(b) - daysStaleFor(a))
  return escalations.slice(0, limit)
}

/**
 * "Ping Dev": logs an escalation note on the lead so Dev sees it in the
 * activity feed and the lead's history carries the escalation trail.
 */
export async function pingDevOnLead(lead, currentPersonId, currentPersonName) {
  const stageLabel = (lead.stage || '').replace(/_/g, ' ')
  return logActivity(lead.id, {
    activity_type: 'note',
    notes: `⚠️ Escalated to Dev by ${currentPersonName || 'team'} (Today tab) — ${daysStaleFor(lead)}d silent in ${stageLabel}`
  }, currentPersonId)
}

/** Unassigned, still-workable leads (id + name only — feeds the banner). */
export async function getUnassignedLeads() {
  // Paged: a bulk import drops thousands of unassigned leads in at once, and
  // the banner's count would stick at 1000.
  return fetchAllRows(() => supabase
    .from('crm_leads')
    .select('id, name, stage')
    .is('assigned_to', null)
    .not('stage', 'in', '(passed,client)'))
}

/**
 * Bulk self-assign: claim every lead in leadIds for personId. Chunked so a
 * large unassigned pool doesn't blow the request URL limit. Returns the
 * number of leads actually claimed.
 */
export async function bulkClaimLeads(leadIds, personId) {
  if (!leadIds?.length || !personId) return 0
  const now = new Date().toISOString()
  let claimed = 0
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200)
    const { data, error } = await supabase
      .from('crm_leads')
      .update({ assigned_to: personId, assigned_by: personId, assigned_date: now })
      .in('id', chunk)
      .select('id')
    if (error) throw error
    claimed += (data || []).length
  }
  cacheClear('leads')
  cacheClear('dashboard')
  return claimed
}

/** Bulk "✓ Touched" — logs a touch (and rolls any cadence) on every lead. */
export async function bulkMarkTouched(leads, currentPersonId, note = '', opts = {}) {
  return runBulk(leads, lead => markLeadTouched(lead, currentPersonId, note, opts))
}

/**
 * Bulk snooze — defers every selected lead by `days`.
 *
 * Routes through snoozeFollowUp rather than writing next_follow_up_date
 * directly: a raw write left any running cadence armed with its old anchor,
 * so the next touch recomputed from that anchor and silently reverted the
 * snooze.
 */
export async function bulkSnoozeLeads(leads, days, currentPersonId) {
  return runBulk(leads, lead => snoozeFollowUp(lead, days, {}, currentPersonId))
}

/** Bulk dismiss — marks every lead dead (stage → passed). */
export async function bulkDismissLeads(leads, currentPersonId) {
  return runBulk(leads, lead => updateLead(lead.id, { stage: 'passed' }, currentPersonId))
}

/**
 * Header-strip extras that need their own queries:
 * - overdueSLA: assigned leads past their staleness threshold (red), plus
 *   new leads past the first-touch SLA (creation + cold threshold days).
 * - touchesThisWeek / touchesLastWeek: activities logged by this person,
 *   bucketed by IST week — the one counter with a computable week-over-week
 *   delta (queue sizes have no historical snapshots).
 */
export async function getTodayCounters(personId) {
  if (!personId) return { overdueSLA: 0, touchesThisWeek: 0, touchesLastWeek: 0 }
  const t = await getTodayThresholds()
  const thisWeekStart = istWeekStart(istDateStr())
  const lastWeekStart = istAddDays(thisWeekStart, -7)
  const activityFrom = new Date(lastWeekStart + 'T00:00:00+05:30').toISOString()

  const leadsQ = supabase
    .from('crm_leads')
    .select('id, stage, created_at, last_activity_date')
    .eq('assigned_to', personId)
    .not('stage', 'in', '(passed,client)')

  const touchesQ = supabase
    .from('crm_lead_activities')
    .select('activity_date')
    .eq('logged_by', personId)
    .gte('activity_date', activityFrom)

  const [leadsRes, touchesRes] = await Promise.all([leadsQ, touchesQ])
  if (leadsRes.error) throw leadsRes.error
  if (touchesRes.error) throw touchesRes.error

  let overdueSLA = 0
  for (const lead of leadsRes.data || []) {
    if (lead.stage === 'new_lead') {
      // First-touch SLA runs from creation, not last activity.
      if (getDaysBetween(new Date(lead.created_at), new Date()) > t.cold) overdueSLA += 1
      continue
    }
    if (calculateStaleness(lead, t.raw).status === 'stale') overdueSLA += 1
  }

  let touchesThisWeek = 0
  let touchesLastWeek = 0
  for (const a of touchesRes.data || []) {
    const week = istWeekStart(istDateStr(new Date(a.activity_date).getTime()))
    if (week === thisWeekStart) touchesThisWeek += 1
    else if (week === lastWeekStart) touchesLastWeek += 1
  }

  return { overdueSLA, touchesThisWeek, touchesLastWeek }
}

/**
 * Admin rollup: touches logged this IST week per person, most active first.
 * Team accountability at a glance above the sections.
 */
export async function getTeamTouchesThisWeek() {
  const from = new Date(istWeekStart(istDateStr()) + 'T00:00:00+05:30').toISOString()
  const { data, error } = await supabase
    .from('crm_lead_activities')
    .select('logged_by, logged_by_person:logged_by(id, name)')
    .gte('activity_date', from)
  if (error) throw error

  const byPerson = new Map()
  for (const row of data || []) {
    if (!row.logged_by) continue
    const cur = byPerson.get(row.logged_by) || {
      personId: row.logged_by,
      name: row.logged_by_person?.name || `#${row.logged_by}`,
      count: 0
    }
    cur.count += 1
    byPerson.set(row.logged_by, cur)
  }
  return [...byPerson.values()].sort((a, b) => b.count - a.count)
}
