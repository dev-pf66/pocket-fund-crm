// One follow-up badge for every board (Nov 2026, UI batch 3).
//
// Sellers, Partners and Italy each carried an identical copy of daysUntil +
// followUpStatus, and the Pipeline board showed a different thing again: an
// absolute DD/MM/YYYY date with an emoji, on every card, however far away.
// Now every board shows the same relative badge — and only when it is worth
// looking at: overdue, today, or within FOLLOW_UP_SOON_DAYS. Since every
// replied lead carries an automatic 30-day check-in (followUpPolicy.js), a
// badge for far-off dates would sit on nearly every card and mean nothing.
// The date itself is always on the record's own page.

import { istToday } from './dateUtils.js'

export const FOLLOW_UP_SOON_DAYS = 3

const DAY = 86400000
const utc = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))

/** Whole days from `today` to a YYYY-MM-DD(…) date. Negative = overdue. */
export function daysUntil(dateStr, today = istToday()) {
  if (!dateStr) return null
  const d = String(dateStr).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  return Math.round((utc(d) - utc(today)) / DAY)
}

/** { kind: 'overdue'|'today'|'soon', label, days } or null when not worth a badge. */
export function followUpStatus(dateStr, today = istToday()) {
  const days = daysUntil(dateStr, today)
  if (days === null) return null
  if (days < 0) return { kind: 'overdue', label: `${-days}d overdue`, days }
  if (days === 0) return { kind: 'today', label: 'Due today', days }
  if (days <= FOLLOW_UP_SOON_DAYS) return { kind: 'soon', label: `In ${days}d`, days }
  return null
}
