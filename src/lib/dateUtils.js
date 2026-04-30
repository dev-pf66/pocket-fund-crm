/**
 * IST Date Utilities
 *
 * ALL date logic in this app uses IST (UTC+5:30).
 * This is hardcoded and must never be changed to browser local time or UTC.
 * India has no DST — the offset is always exactly +05:30.
 *
 * The stored value for any "date" field is always YYYY-MM-DD in IST.
 * Time can be stored separately as a UTC timestamp, but the date portion
 * must always reflect the IST calendar day.
 */

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000 // +05:30 = 19 800 000 ms

/**
 * Returns today's date in IST as YYYY-MM-DD.
 * Use this everywhere "today" is needed.
 */
export function istToday() {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().split('T')[0]
}

/**
 * Add or subtract n calendar days from a YYYY-MM-DD string.
 * Parses at UTC noon so the operation is never affected by any timezone.
 */
export function istAddDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

/**
 * Returns the Monday of the ISO week that contains dateStr (YYYY-MM-DD).
 * Used to group outreach entries into weekly buckets.
 */
export function istWeekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = d.getUTCDay() // 0 = Sunday
  const offset = day === 0 ? -6 : 1 - day
  return istAddDays(dateStr, offset)
}

/**
 * Format a YYYY-MM-DD string for display — e.g. "Apr 30".
 * Always parses at UTC noon so the displayed day matches the stored date.
 */
export function fmtDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
