// Guardrails for phone normalization.
//
// The CSV importer stores numbers as E.164 so the Cold Calls dial button can
// hand them to CallHippo. The failure mode worth pinning is not "ugly
// formatting" — it's a number that was silently CHANGED into a different,
// valid-looking number. That dials someone else, or fails at 2pm on a call
// block with no error anywhere. So: resolve confidently or don't touch it.

import { describe, it, expect } from 'vitest'
import { normalizePhone, normalizePhoneList, DIAL_CODES } from '../src/lib/phone'

const v = (raw, code = '1') => normalizePhone(raw, code)

describe('numbers that are already international', () => {
  it('keeps a well-formed E.164 number untouched', () => {
    const r = v('+14155550142')
    expect(r.e164).toBe('+14155550142')
    expect(r.ok).toBe(true)
    expect(r.changed).toBe(false)
  })

  it('strips formatting without changing the number', () => {
    expect(v('+1 (415) 555-0142').e164).toBe('+14155550142')
    expect(v('+91 98765 43210').e164).toBe('+919876543210')
    expect(v('+44 20 7946 0018').e164).toBe('+442079460018')
  })

  it('treats a 00 prefix as the international access code', () => {
    // 0044... is how the rest of the world writes +44.
    expect(v('0044 20 7946 0018').e164).toBe('+442079460018')
  })

  it('ignores the import default when the number already has a country code', () => {
    // An Indian number in a US-defaulted import must stay Indian.
    expect(normalizePhone('+919876543210', '1').e164).toBe('+919876543210')
  })
})

describe('local numbers plus an import default', () => {
  it('applies the US code to a 10-digit number', () => {
    expect(v('4155550142').e164).toBe('+14155550142')
    expect(v('(415) 555-0142').e164).toBe('+14155550142')
    expect(v('415.555.0142').e164).toBe('+14155550142')
  })

  it('handles a US number already carrying a bare leading 1', () => {
    expect(v('1-415-555-0142').e164).toBe('+14155550142')
  })

  it('strips the national trunk zero', () => {
    // 098765 43210 is how an Indian mobile is written domestically; the 0 is
    // a dialling artefact, not part of the international number.
    expect(normalizePhone('098765 43210', '91').e164).toBe('+919876543210')
    expect(normalizePhone('020 7946 0018', '44').e164).toBe('+442079460018')
  })

  it('supports every country code offered in the picker', () => {
    for (const c of DIAL_CODES) {
      const local = '9'.repeat(c.nationalLength[0])
      const r = normalizePhone(local, c.code)
      expect(r.ok, `${c.label} should resolve a ${c.nationalLength[0]}-digit local number`).toBe(true)
      expect(r.e164).toBe(`+${c.code}${local}`)
    }
  })
})

describe('refusing to guess', () => {
  it('leaves the number untouched when no default country is set', () => {
    const r = normalizePhone('4155550142', null)
    expect(r.ok).toBe(false)
    expect(r.value).toBe('4155550142')   // stored as typed, not mangled
    expect(r.e164).toBeNull()
  })

  it('never pads or truncates a wrong-length number', () => {
    // 7 digits is not a US number. Padding it would produce a real number
    // belonging to somebody else.
    const r = v('555-0142')
    expect(r.ok).toBe(false)
    expect(r.value).toBe('555-0142')
    expect(r.reason).toMatch(/not a local number/)
  })

  it('rejects a vanity number rather than inventing digits', () => {
    const r = v('1-800-FLOWERS')
    expect(r.ok).toBe(false)
    expect(r.value).toBe('1-800-FLOWERS')
  })

  it('rejects a number too long to be E.164', () => {
    expect(v('+1234567890123456').ok).toBe(false)
  })

  it('handles empty and junk cells without throwing', () => {
    for (const junk of ['', '   ', null, undefined, '-', 'n/a']) {
      const r = v(junk)
      expect(r.ok).toBe(false)
      expect(() => r.value).not.toThrow()
    }
    expect(v('').value).toBe('')
  })
})

describe('extensions', () => {
  it('separates an extension instead of dialling it', () => {
    // "+14155550142x203" as one string does not dial.
    const r = v('(415) 555-0142 x203')
    expect(r.e164).toBe('+14155550142')
    expect(r.extension).toBe('203')
  })

  it('recognises the long form too', () => {
    expect(v('415-555-0142 ext. 88').extension).toBe('88')
  })
})

describe('normalizePhoneList', () => {
  it('counts what happened so the import preview can show it before writing', () => {
    const s = normalizePhoneList(
      ['+14155550142', '(415) 555-0143', '555-0144', ''],
      '1'
    )
    expect(s.total).toBe(3)          // the empty cell is not a phone
    expect(s.alreadyValid).toBe(1)
    expect(s.normalized).toBe(1)
    expect(s.unresolved).toBe(1)
  })
})
