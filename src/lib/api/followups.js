/**
 * CRM API — follow-up reminders: scheduling the next reach-out on a lead,
 * reusable multi-touch cadences, and the notification counts behind the
 * sidebar bell.
 *
 * The scheduled date itself still lives on crm_leads.next_follow_up_date —
 * the column the Today tab, LeadCard and the Notifications page already read.
 * This module adds the note ("what to say"), the cadence state machine, and
 * the due/overdue rollup. Nothing here introduces a second source of truth.
 */

import { supabase } from '../supabase'
import { istToday, istAddDays } from '../dateUtils'
import { cacheClear } from './core'
import { updateLead, logActivity } from './leads'

// A lead that's won or dead never nags.
const TERMINAL_STAGES = ['client', 'passed']

// ============================================================================
// CADENCE LIBRARY
// ============================================================================

/** Shared cadence library, active ones first-class. Ordered oldest → newest. */
export async function getFollowUpCadences({ includeInactive = false } = {}) {
  let q = supabase.from('crm_followup_cadences').select('*').order('id')
  if (!includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Save a new reusable cadence. `offsets` are days from the day it's applied
 * (e.g. [3, 10, 30]); they're de-duplicated and sorted so the state machine
 * can assume they only move forward.
 */
export async function createFollowUpCadence({ name, description = null, offsets }, currentPersonId = null) {
  const clean = [...new Set((offsets || []).map(Number).filter(n => Number.isFinite(n) && n > 0))]
    .sort((a, b) => a - b)
  if (!name?.trim()) throw new Error('Cadence needs a name')
  if (clean.length === 0) throw new Error('Cadence needs at least one positive day offset')

  const { data, error } = await supabase
    .from('crm_followup_cadences')
    .insert([{ name: name.trim(), description, offsets: clean, created_by: currentPersonId }])
    .select()
    .single()
  if (error) throw error
  return data
}

/** Retire a cadence without breaking leads already running it. */
export async function deactivateFollowUpCadence(id) {
  const { error } = await supabase
    .from('crm_followup_cadences')
    .update({ is_active: false })
    .eq('id', id)
  if (error) throw error
}

// ============================================================================
// PER-LEAD SCHEDULING
// ============================================================================

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). */
function daysBetween(from, to) {
  const ms = new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')
  return Math.round(ms / 86400000)
}

/**
 * Schedule an explicit reach-out date. Setting a date by hand ends any
 * running cadence — the manual call wins over the automation. Deferring
 * (see snoozeFollowUp) passes keepCadence so it can shift the schedule
 * instead of destroying it.
 */
export async function setFollowUp(leadId, { date, note = null, keepCadence = undefined }, currentPersonId = null) {
  if (!date) throw new Error('setFollowUp needs a date')
  const updates = {
    next_follow_up_date: date,
    follow_up_note: note?.trim() ? note.trim() : null
  }
  // undefined = leave the column alone; null = explicitly end the cadence.
  updates.follow_up_cadence = keepCadence === undefined ? null : keepCadence
  const updated = await updateLead(leadId, updates, currentPersonId)
  cacheClear('leads')
  return updated
}

/**
 * Defer a reach-out by `days` — the +1d / +1w / snooze buttons.
 *
 * Two rules that the naive version got wrong:
 *  - It counts from the lead's OWN scheduled date when that's still in the
 *    future, not from today. "+1w" on something due next month used to drag
 *    it BACKWARDS to a week from today.
 *  - A running cadence is shifted, not deleted. The anchor moves by the same
 *    number of days, so the pending touch lands on the new date and every
 *    later touch keeps its original spacing. Previously this routed through
 *    setFollowUp and silently wiped the remaining touches.
 *
 * Takes the lead ROW (not just an id) because both rules need its state.
 */
export async function snoozeFollowUp(lead, days, { note = null } = {}, currentPersonId = null) {
  const n = Number(days)
  if (!Number.isFinite(n)) throw new Error('snoozeFollowUp needs a number of days')

  const today = istToday()
  const current = lead?.next_follow_up_date
  // Defer from whichever is later: today, or the date already promised.
  const base = current && current > today ? current : today
  const date = istAddDays(base, n)

  const cadence = lead?.follow_up_cadence
  let keepCadence
  if (cadence?.offsets?.length && current) {
    const shift = daysBetween(current, date)
    keepCadence = { ...cadence, anchor: istAddDays(cadence.anchor, shift) }
  }

  return setFollowUp(lead.id, { date, note, keepCadence }, currentPersonId)
}

/** Drop the reminder entirely — no date, no note, no cadence. */
export async function clearFollowUp(leadId, currentPersonId = null) {
  const updated = await updateLead(leadId, {
    next_follow_up_date: null,
    follow_up_note: null,
    follow_up_cadence: null
  }, currentPersonId)
  cacheClear('leads')
  return updated
}

/**
 * Apply a cadence in one click: schedules the first touch and records the
 * state needed to schedule the rest. `cadence` is a row from
 * crm_followup_cadences (or any { name, offsets } shape).
 */
export async function applyFollowUpCadence(leadId, cadence, { note = null } = {}, currentPersonId = null) {
  const offsets = [...(cadence?.offsets || [])].map(Number).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  if (offsets.length === 0) throw new Error('Cadence has no valid day offsets')

  const anchor = istToday()
  const updated = await updateLead(leadId, {
    next_follow_up_date: istAddDays(anchor, offsets[0]),
    follow_up_note: note?.trim() ? note.trim() : null,
    follow_up_cadence: { name: cadence.name || 'Cadence', offsets, step: 1, anchor }
  }, currentPersonId)
  cacheClear('leads')
  return updated
}

/**
 * Move a lead to the next step of its cadence. Called after a touch is
 * logged, so working a lead early still lands the next reminder on the
 * cadence's own schedule (anchor + offsets[step]) rather than restarting the
 * clock from the touch.
 *
 * Steps that have already gone by are skipped — a lead touched on day 12 of a
 * 3/10/30 cadence jumps straight to day 30. When the cadence runs out, the
 * reminder clears and the lead falls back to normal staleness ranking.
 *
 * Returns the cadence state that was written, or null if the lead had no
 * cadence running / the cadence finished.
 */
export async function advanceFollowUpCadence(lead, currentPersonId = null) {
  const cadence = lead?.follow_up_cadence
  if (!cadence?.offsets?.length) return null

  const today = istToday()
  let step = Number(cadence.step) || 0

  // The touch that's currently pending is offsets[step-1]. If it hasn't come
  // due yet, this touch was early (the lead surfaced in Today on staleness,
  // not on its reminder) and the cadence should be left exactly where it is —
  // otherwise the pending touch is silently consumed and the lead gets one
  // fewer reach-out than the cadence promises.
  const pending = step > 0 ? istAddDays(cadence.anchor, cadence.offsets[step - 1]) : null
  if (pending && pending > today) return cadence

  let nextDate = null
  while (step < cadence.offsets.length) {
    const candidate = istAddDays(cadence.anchor, cadence.offsets[step])
    step += 1
    if (candidate > today) { nextDate = candidate; break }
  }

  if (!nextDate) {
    await updateLead(lead.id, {
      next_follow_up_date: null,
      follow_up_cadence: null,
      follow_up_note: null
    }, currentPersonId)
    cacheClear('leads')
    return null
  }

  const state = { ...cadence, step }
  await updateLead(lead.id, { next_follow_up_date: nextDate, follow_up_cadence: state }, currentPersonId)
  cacheClear('leads')
  return state
}

/**
 * Log the reach-out and roll the cadence forward in one call — what the
 * "Reached out" button on the follow-up card does.
 */
export async function logFollowUpTouch(lead, currentPersonId, { note = '', activityType = 'note' } = {}) {
  const trimmed = (note || '').trim()
  const activity = await logActivity(lead.id, {
    activity_type: activityType,
    notes: trimmed || `Followed up${lead.follow_up_note ? ` — ${lead.follow_up_note}` : ''}`
  }, currentPersonId)

  // No cadence running: the one-off reminder is spent, so retire it.
  if (!lead.follow_up_cadence?.offsets?.length) {
    if (lead.next_follow_up_date) await clearFollowUp(lead.id, currentPersonId)
    return { activity, cadence: null }
  }
  const cadence = await advanceFollowUpCadence(lead, currentPersonId)
  return { activity, cadence }
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

/**
 * Follow-ups that should be nagging someone right now: assigned to personId,
 * still workable, scheduled on or before today. Feeds the sidebar bell —
 * overdue and due-today are counted separately so the bell can go red only
 * when something has actually slipped.
 *
 * personId null aggregates across every owner (admin view).
 */
export async function getFollowUpNotifications(personId = null, { limit = 8 } = {}) {
  const today = istToday()
  let q = supabase
    .from('crm_leads')
    .select('id, name, firm_name, stage, assigned_to, next_follow_up_date, follow_up_note, follow_up_cadence')
    .not('next_follow_up_date', 'is', null)
    .lte('next_follow_up_date', today)
    .not('stage', 'in', `(${TERMINAL_STAGES.join(',')})`)
    .order('next_follow_up_date')
  if (personId) q = q.eq('assigned_to', personId)

  const { data, error } = await q
  if (error) throw error

  const leads = data || []
  return {
    total: leads.length,
    overdue: leads.filter(l => l.next_follow_up_date < today).length,
    dueToday: leads.filter(l => l.next_follow_up_date === today).length,
    leads: leads.slice(0, limit)
  }
}

/**
 * Everything scheduled, bucketed — what the Notifications page renders.
 * Unlike getFollowUpNotifications (counts + a preview, for the bell), this
 * returns full lead rows and looks forward as well as back, so the page can
 * answer "what's coming" and not just "what have I missed".
 *
 * personId null aggregates across every owner (admin view).
 */
export async function getFollowUpBoard(personId = null, { upcomingDays = 14 } = {}) {
  const today = istToday()
  const horizon = istAddDays(today, upcomingDays)

  let q = supabase
    .from('crm_leads')
    .select('*')
    .not('next_follow_up_date', 'is', null)
    .lte('next_follow_up_date', horizon)
    .not('stage', 'in', `(${TERMINAL_STAGES.join(',')})`)
    .order('next_follow_up_date')
  if (personId) q = q.eq('assigned_to', personId)

  const { data, error } = await q
  if (error) throw error

  const leads = data || []
  return {
    overdue: leads.filter(l => l.next_follow_up_date < today),
    dueToday: leads.filter(l => l.next_follow_up_date === today),
    upcoming: leads.filter(l => l.next_follow_up_date > today),
    horizon,
    upcomingDays
  }
}
