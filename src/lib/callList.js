/**
 * Parsing a pasted cold-call list into rows the CRM can store.
 *
 * The general Outreach Queue takes LinkedIn URLs, which are self-identifying —
 * a URL is unambiguous and the name falls out of the slug. A call list is not:
 * it arrives as "name, number", "name, firm, number", or a bare column of
 * numbers, in whatever order the source felt like.
 *
 * So the phone is found by SHAPE rather than by position, and whatever is left
 * is read as name then firm. Two rules carried over from phone.js, both about
 * not inventing anything:
 *
 *  1. A number that will not resolve is kept VERBATIM and flagged, never
 *     guessed at and never dropped. The caller sees the count before writing.
 *  2. A row with no name is filed under its own number, not a made-up name.
 *     Same reasoning as the "@slug" placeholder on LinkedIn imports — a
 *     visible non-name beats a plausible fake one.
 */

import { normalizePhone } from './phone'

// Enough digits to be a phone rather than an extension, a headcount or a year.
const MIN_PHONE_DIGITS = 7

const digitCount = (s) => (String(s).match(/\d/g) || []).length

/** Does this field look like a phone number rather than a name or a firm? */
function looksLikePhone(field) {
  if (!field) return false
  // A field with letters in it is a name or a firm, not a number — except for
  // a leading "+" or separators, which are punctuation, not letters.
  if (/[a-z]/i.test(field.replace(/^\s*(tel|phone|mobile|ph)[:.]?\s*/i, ''))) return false
  return digitCount(field) >= MIN_PHONE_DIGITS
}

/**
 * Parse one pasted block.
 *
 * @param {string} text          the textarea contents or an uploaded file
 * @param {string|null} defaultCode  dial code without '+' to apply to local
 *                                   numbers, e.g. '1'. null = never guess.
 * @returns {{ rows: Array<{name,firm_name,phone,rawPhone,resolved}>,
 *             invalid: Array<{line,reason}>, unresolved: number }}
 */
export function parseCallListText(text, defaultCode = null) {
  const rows = []
  const invalid = []

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const fields = line.split(/[,\t;]/).map(f => f.trim()).filter(Boolean)
    if (fields.length === 0) continue

    // Prefer a field that is unambiguously phone-shaped; fall back to whichever
    // field carries the most digits, so "John Smith 415 555 0142" still works
    // when the source forgot the separator.
    let phoneIdx = fields.findIndex(looksLikePhone)
    if (phoneIdx === -1) {
      let best = -1, bestDigits = 0
      fields.forEach((f, i) => {
        const d = digitCount(f)
        if (d > bestDigits) { bestDigits = d; best = i }
      })
      if (bestDigits >= MIN_PHONE_DIGITS) phoneIdx = best
    }

    if (phoneIdx === -1) {
      invalid.push({ line, reason: 'no phone number found' })
      continue
    }

    const rawPhone = fields[phoneIdx]
    const rest = fields.filter((_, i) => i !== phoneIdx)
    const norm = normalizePhone(rawPhone, defaultCode)

    rows.push({
      // `value` is the E.164 form when it resolved and the original string
      // when it did not — always safe to store, never a guess.
      phone: norm.value,
      rawPhone,
      resolved: norm.ok,
      // No name given? File them under their number rather than "Unknown",
      // which collapses a whole batch onto one indistinguishable name.
      name: rest[0] || norm.value,
      firm_name: rest[1] || ''
    })
  }

  return {
    rows,
    invalid,
    unresolved: rows.filter(r => !r.resolved).length
  }
}

/** Comparison key for dedup — digits only, so formatting never hides a match. */
export function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  // A leading country code may or may not be present in what is already
  // stored, so compare on the last 10 digits — the part that identifies the
  // line itself in every numbering plan we call into.
  return digits.length > 10 ? digits.slice(-10) : digits
}
