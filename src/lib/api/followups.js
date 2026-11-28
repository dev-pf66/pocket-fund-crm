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

import { supabase } from '../supabase.js'
import { istToday, istAddDays } from '../dateUtils.js'
import { cacheClear } from './core.js'
import { updateLead, logActivity } from './leads.js'
import { DEFAULT_FOLLOW_UP_DAYS, DEFAULT_FOLLOW_UP_NOTE, getsDefaultReminder } from '../followUpPolicy.js'
import { ownerScopeIds, scopeToOwners } from './cover.js'

// A lead that's won or dead never nags.
const TERMINAL_STAGES = ['client', 'passed']

// Notifications (bell + Notifications page) only nag about the last 2
// weeks of overdue — a follow-up missed months ago shouldn't nag forever.
// It's still fully there on the lead and reachable via Pipeline; it just
// stops pinging. Mirrors RECENT_WINDOW_DAYS in lib/api/today.js.
const OVERDUE_WINDOW_DAYS = 14

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
  return snoozeFollowUpTo(lead, istAddDays(base, n), { note }, currentPersonId)
}

/**
 * Move a reach-out to an exact date — the snooze menu's "Start of next month",
 * "New year", "Pick a date", and a typed update ("start of the new year").
 * Unlike snoozeFollowUp it honours the date even when it is EARLIER than the
 * one already set: the person picked that day on purpose.
 *
 * A running cadence is shifted by the same number of days, never deleted —
 * the same rule as snoozeFollowUp, which routes through here.
 */
export async function snoozeFollowUpTo(lead, date, { note = null } = {}, currentPersonId = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('snoozeFollowUpTo needs a YYYY-MM-DD date')
  const current = lead?.next_follow_up_date
  const cadence = lead?.follow_up_cadence
  let keepCadence
  if (cadence?.offsets?.length && current) {
    const shift = daysBetween(String(current).slice(0, 10), date)
    keepCadence = { ...cadence, anchor: istAddDays(cadence.anchor, shift) }
  }
  return setFollowUp(lead.id, { date, note, keepCadence }, currentPersonId)
}

/**
 * The note to keep when someone snoozes from a list. The automatic "30-day
 * check-in" note marks a reminder as a safety net (isDefaultReminder); once a
 * person has deliberately pushed it, it is their decision, so the default note
 * is dropped and the Today queue / "gone quiet" stop nagging until that date.
 * A note somebody typed ("ask about the Q3 board") is carried over unchanged.
 */
export function snoozeNoteFor(lead) {
  const note = lead?.follow_up_note
  return note && note !== DEFAULT_FOLLOW_UP_NOTE ? note : null
}

/**
 * A typed update after a conversation (Dev, 2026-11-28): "I can type in 'reach
 * out in the start of the new year' and then it pops up on Today in Jan."
 *
 * Writes two things, in this order:
 *   1. the update itself as a note activity on the lead — a conversation
 *      happened, so it stamps last_activity_date like any touch, and the words
 *      are in the lead's history for whoever picks it up in January;
 *   2. the reminder, on the date the person confirmed, with their words as the
 *      reminder note, so the Today row says why it is back.
 * A running cadence is ended (setFollowUp): a date someone was told beats the
 * automation.
 *
 * The date must come from the caller — parsed by src/lib/reminderParse.js or
 * Claude, and SHOWN to the person before saving. This function never guesses.
 */
export async function logLeadUpdate(lead, { text, date }, currentPersonId = null, { followUp = false } = {}) {
  const words = String(text || '').trim()
  if (!words) throw new Error('Type what happened first')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('Pick the date to reach out')
  if (date <= istToday()) throw new Error('The reminder date has to be after today')

  const activity = await logActivity(lead.id, {
    activity_type: 'note',
    notes: updateNote(lead, words, { followUp })
  }, currentPersonId)
  const updated = await setFollowUp(lead.id, { date, note: words.slice(0, 280) }, currentPersonId)
  return { activity, lead: updated }
}

/**
 * The activity note an update writes. When the lead's follow-up was due (or the
 * row came from Today's "Follow-ups due"), it carries the `Followed up` prefix
 * the scoreboard counts — an update after a call IS the follow-up. Otherwise it
 * is a plain `Update` note. Pure; pinned in test/lead-update.test.js.
 */
export function updateNote(lead, text, { followUp = false } = {}, today = istToday()) {
  const due = lead?.next_follow_up_date
  const isDue = followUp || (!!due && String(due).slice(0, 10) <= today)
  return isDue ? `Followed up (update) — ${text}` : `Update — ${text}`
}

/**
 * Ask Claude to read a typed reminder the local parser couldn't
 * ("after Diwali", "when their fund closes in spring"). Dispatched from
 * /api/analyze-transcript (action: parse_reminder) — the Hobby plan caps us at
 * 12 function files, so this is not its own route. Returns { date, rule } or
 * { date: null, rule } when Claude can't tell either.
 */
export async function parseReminderWithAI(text) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')
  const response = await fetch('/api/analyze-transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: 'parse_reminder', text, today: istToday() })
  })
  let result
  try { result = await response.json() } catch { throw new Error(`Reminder reader unavailable (HTTP ${response.status})`) }
  if (!response.ok || !result.success) throw new Error(result.error || 'Could not read that')
  return { date: result.date || null, rule: result.rule || '' }
}

/**
 * EVERY LIVE LEAD ALWAYS HAS A NEXT REMINDER (Dev, 2026-11-16: "there should
 * always be an automatic follow-up reminder, unless we are marking the lead as
 * dead — whether that's 30 days, 90 days"). Wherever a follow-up is completed
 * or removed — Touched, Reached out, a cadence running out, the clear buttons —
 * the next reminder lands DEFAULT_FOLLOW_UP_DAYS out instead of the lead going
 * silent. Only marking a lead dead (stage → passed) ends its reminders.
 * Guardrail: test/always-a-reminder.test.js. Change the interval here only.
 */
export { DEFAULT_FOLLOW_UP_DAYS, DEFAULT_FOLLOW_UP_NOTE }

export function defaultFollowUpDate(today = istToday()) {
  return istAddDays(today, DEFAULT_FOLLOW_UP_DAYS)
}

/** Replace whatever reminder a lead has with the default check-in (ends any cadence). */
export async function resetFollowUpToDefault(leadId, currentPersonId = null) {
  return setFollowUp(leadId, { date: defaultFollowUpDate(), note: DEFAULT_FOLLOW_UP_NOTE }, currentPersonId)
}

/**
 * Drop the reminder entirely — no date, no note, no cadence. Since 2026-11-16
 * a replied lead never takes this path (resetFollowUpToDefault instead); it is
 * only used to retire a spent reminder on a lead outside REMINDER_STAGES.
 * Dead leads clear theirs in the same update that sets stage passed.
 */
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
 * lead gets the default check-in DEFAULT_FOLLOW_UP_DAYS out (never no reminder).
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
    // Cadence finished: a replied lead still gets a next reminder, never silence.
    const keep = getsDefaultReminder(lead)
    await updateLead(lead.id, {
      next_follow_up_date: keep ? defaultFollowUpDate(today) : null,
      follow_up_cadence: null,
      follow_up_note: keep ? DEFAULT_FOLLOW_UP_NOTE : null
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
 * The note a "Reached out" follow-up touch writes. It must ALWAYS start with
 * `Followed up` — that prefix is what the scoreboard's "F/U done" column counts.
 * A typed note used to be written bare, so a follow-up logged with a note
 * counted nowhere (fixed 2026-11-15; test/follow-up-done.test.js).
 */
export function followUpNote(lead, note = '') {
  const trimmed = (note || '').trim()
  if (trimmed) return `Followed up — ${trimmed}`
  return `Followed up${lead?.follow_up_note ? ` — ${lead.follow_up_note}` : ''}`
}

/**
 * Log the reach-out and roll the cadence forward in one call — what the
 * "Reached out" button on the follow-up card does.
 */
export async function logFollowUpTouch(lead, currentPersonId, { note = '', activityType = 'note' } = {}) {
  const activity = await logActivity(lead.id, {
    activity_type: activityType,
    notes: followUpNote(lead, note)
  }, currentPersonId)

  // No cadence running: the one-off reminder is spent. A replied lead gets the
  // default check-in next (it never goes without one unless dead); anything else
  // just retires the spent reminder, as before. Unlike an early Touched, Reached
  // out is explicitly about THIS follow-up, so it consumes a future one too.
  // The activity is already logged, so a failed reminder write is reported, not
  // thrown — a thrown error invites a retry that logs the follow-up twice.
  if (!lead.follow_up_cadence?.offsets?.length) {
    try {
      if (getsDefaultReminder(lead)) await resetFollowUpToDefault(lead.id, currentPersonId)
      else if (lead.next_follow_up_date) await clearFollowUp(lead.id, currentPersonId)
    } catch (err) {
      console.error('Scheduling the next reminder failed (reach-out was logged):', err)
    }
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
 * still workable, scheduled on or before today and no more than
 * OVERDUE_WINDOW_DAYS (2 weeks) overdue. Feeds the sidebar bell — overdue
 * and due-today are counted separately so the bell can go red only when
 * something has actually slipped. Anything overdue longer than that stops
 * nagging (it's still on the lead, just not surfaced here).
 *
 * personId null aggregates across every owner (admin view).
 */
export async function getFollowUpNotifications(personId = null, { limit = 8 } = {}) {
  const today = istToday()
  const floor = istAddDays(today, -OVERDUE_WINDOW_DAYS)
  let q = supabase
    .from('crm_leads')
    .select('id, name, firm_name, stage, assigned_to, next_follow_up_date, follow_up_note, follow_up_cadence')
    .eq('is_archived', false)
    .not('next_follow_up_date', 'is', null)
    .lte('next_follow_up_date', today)
    .gte('next_follow_up_date', floor)
    .not('stage', 'in', `(${TERMINAL_STAGES.join(',')})`)
    .order('next_follow_up_date')
  q = scopeToOwners(q, await ownerScopeIds(personId))

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
 * answer "what's coming" and not just "what have I missed" — but same as the
 * bell, overdue is capped at OVERDUE_WINDOW_DAYS so an ancient miss doesn't
 * dominate the page forever.
 *
 * personId null aggregates across every owner (admin view).
 */
export async function getFollowUpBoard(personId = null, { upcomingDays = 14, overdueWindowDays = OVERDUE_WINDOW_DAYS } = {}) {
  const today = istToday()
  const horizon = istAddDays(today, upcomingDays)
  const floor = istAddDays(today, -overdueWindowDays)

  let q = supabase
    .from('crm_leads')
    .select('*')
    .eq('is_archived', false)
    .not('next_follow_up_date', 'is', null)
    .lte('next_follow_up_date', horizon)
    .gte('next_follow_up_date', floor)
    .not('stage', 'in', `(${TERMINAL_STAGES.join(',')})`)
    .order('next_follow_up_date')
  q = scopeToOwners(q, await ownerScopeIds(personId))

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
