/**
 * Phone number normalization to E.164 (`+` followed by 8–15 digits).
 *
 * Cold calling needs this: the dial button hands the number to CallHippo, and
 * a number stored as "(415) 555-0142" or "415.555.0142" doesn't reliably dial.
 * Sourced call lists arrive in every format there is, so the CSV importer
 * normalizes on the way in rather than leaving 300 rows to fix by hand.
 *
 * TWO RULES, both about not destroying data:
 *
 *  1. A number that can't be confidently resolved is returned UNCHANGED with
 *     ok:false. We never guess a country code onto an ambiguous number and we
 *     never drop digits — a wrong number in the CRM is worse than an ugly one,
 *     because it looks fine and fails silently at dial time.
 *  2. The caller is told which rows didn't resolve, so the import preview can
 *     show them before anything is written.
 */

// Country dial codes we can apply to a local number. `nationalLength` is the
// digit count of a local number in that country, used to tell "this is a local
// number missing its country code" from "this is something else entirely".
export const DIAL_CODES = [
  { code: '1',  label: 'US / Canada (+1)',  nationalLength: [10] },
  { code: '91', label: 'India (+91)',       nationalLength: [10] },
  { code: '44', label: 'UK (+44)',          nationalLength: [10, 9] },
  { code: '61', label: 'Australia (+61)',   nationalLength: [9] },
  { code: '65', label: 'Singapore (+65)',   nationalLength: [8] },
  { code: '971', label: 'UAE (+971)',       nationalLength: [9] },
]

const BY_CODE = new Map(DIAL_CODES.map(c => [c.code, c]))

// "x123", "ext. 456", "extension 7" — captured separately rather than being
// silently glued onto the number, where it would make the dial fail.
const EXTENSION = /(?:,|;|\s)*(?:x|ext\.?|extension)\s*(\d{1,6})\s*$/i

/**
 * Normalize one number.
 *
 * @param {string} raw            whatever was in the spreadsheet cell
 * @param {string|null} defaultCode  dial code (no '+') to apply to a local
 *                                   number, e.g. '1'. null = never guess.
 * @returns {{ e164: string|null, value: string, ok: boolean, reason: string|null,
 *             extension: string|null, changed: boolean }}
 *          `value` is always safe to store: the E.164 form when resolved, the
 *          original string when not.
 */
export function normalizePhone(raw, defaultCode = null) {
  const original = String(raw ?? '').trim()
  const fail = (reason) => ({
    e164: null, value: original, ok: false, reason, extension: null, changed: false,
  })

  if (!original) return { e164: null, value: '', ok: false, reason: null, extension: null, changed: false }

  // Pull off an extension before touching anything else.
  let work = original
  let extension = null
  const extMatch = work.match(EXTENSION)
  if (extMatch) {
    extension = extMatch[1]
    work = work.slice(0, extMatch.index).trim()
  }

  // A leading '+' is the only meaningful non-digit. '00' is the international
  // access prefix used across most of the world and means the same thing.
  const hasPlus = work.startsWith('+')
  let digits = work.replace(/\D/g, '')
  let international = hasPlus

  if (!international && digits.startsWith('00')) {
    digits = digits.slice(2)
    international = true
  }

  if (!digits) return fail('no digits')
  // Letters in the middle ("555-CALL") can't be dialled and can't be guessed.
  if (/[a-z]/i.test(work.replace(/^\+/, '').replace(/[\s\-().]/g, ''))) return fail('contains letters')

  const done = (d) => {
    if (d.length < 8 || d.length > 15) return fail(`${d.length} digits — not a valid international number`)
    const e164 = `+${d}`
    return { e164, value: e164, ok: true, reason: null, extension, changed: e164 !== original }
  }

  // Already international: trust it, just tidy the formatting.
  if (international) return done(digits)

  if (!defaultCode) return fail('no country code, and none set for this import')

  const country = BY_CODE.get(String(defaultCode))
  if (!country) return fail(`unknown country code +${defaultCode}`)

  // Strip a national trunk prefix — the leading 0 in "020 7946 0018" (UK) or
  // "098765 43210" (India) is a domestic-dialling artefact and is not part of
  // the international number.
  let local = digits
  if (local.startsWith('0')) local = local.replace(/^0+/, '')

  // "1 415 555 0142" for +1, "91 98765 43210" for +91 — the country code is
  // already there, just without the plus.
  if (local.startsWith(country.code)) {
    const withoutCode = local.slice(country.code.length)
    if (country.nationalLength.includes(withoutCode.length)) return done(local)
  }

  if (country.nationalLength.includes(local.length)) return done(`${country.code}${local}`)

  // Right country, wrong length — flag it rather than padding or truncating.
  return fail(`${local.length} digits — not a local number for +${country.code}`)
}

/**
 * Normalize a list, reporting what happened. Used by the CSV import preview
 * so the unresolved rows are visible BEFORE anything is written.
 */
export function normalizePhoneList(values, defaultCode = null) {
  const results = values.map(v => normalizePhone(v, defaultCode))
  return {
    results,
    total: results.filter(r => r.value !== '').length,
    normalized: results.filter(r => r.ok && r.changed).length,
    alreadyValid: results.filter(r => r.ok && !r.changed).length,
    unresolved: results.filter(r => !r.ok && r.value !== '').length,
  }
}
