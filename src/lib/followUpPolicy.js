// Follow-up reminder policy (Dev, 2026-11-16): "there should always be an
// automatic follow-up reminder, unless we are marking the lead as dead —
// whether that's 30 days, 90 days."
//
// Pure and import-free so both src/lib/api/leads.js and followups.js can use it
// without a circular import. Change the interval HERE and nowhere else.
// Guardrail: test/always-a-reminder.test.js.

export const DEFAULT_FOLLOW_UP_DAYS = 30
export const DEFAULT_FOLLOW_UP_NOTE = `${DEFAULT_FOLLOW_UP_DAYS}-day check-in`

// Who gets the automatic reminder: leads that have REPLIED — the same set the
// Today tab works (responded and beyond, plus reach_out_later). Not `outreach`
// (never answered; that work lives in Cold Calls / Tracker — giving them one
// would land e.g. a 150-lead board bulk touch in the bell on the same morning),
// not `client`, and never `passed` (dead ends reminders).
export const REMINDER_STAGES = ['responded', 'meeting_booked', 'warm_active', 'reach_out_later']

export function getsDefaultReminder(lead) {
  return REMINDER_STAGES.includes(lead?.stage)
}

// The automatic check-in is a SAFETY NET, not a promise someone made. The
// faster staleness nudges ("gone quiet" after 3-7 days, Today's day-3/7/14
// marks) only look at leads without a promise, so they treat this one as none —
// otherwise the 30-day floor would silence them for a month.
export function isDefaultReminder(lead) {
  return !!lead?.next_follow_up_date && lead?.follow_up_note === DEFAULT_FOLLOW_UP_NOTE
}

// Marking a lead dead is the ONE thing that ends its reminders.
export const DEAD_REMINDER_RESET = { next_follow_up_date: null, follow_up_cadence: null }
