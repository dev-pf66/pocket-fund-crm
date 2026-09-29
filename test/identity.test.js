// Guardrail: how the app resolves "which person am I?"
//
// This encodes a rule, not just behaviour: app-side identity matching MUST
// agree with how RLS resolves it (current_person_id() matches on LOWER(email)).
// When these two disagreed, a differently-cased login minted a duplicate
// people row and the UI and the database silently disagreed about who you
// were — leads attaching to a person id the user never sees.

import { describe, it, expect } from 'vitest'
import { normaliseEmail, findPersonByEmail } from '../src/lib/identity.js'

const PEOPLE = [
  { id: 1, email: 'dev@pocket-fund.com', name: 'Dev' },
  { id: 2, email: 'Aum@Pocket-Fund.com', name: 'Aum' },
  { id: 3, email: null, name: 'No email' }
]

describe('normaliseEmail', () => {
  it('lower-cases and trims, matching the SQL LOWER(TRIM(email))', () => {
    expect(normaliseEmail('  Dev@Pocket-Fund.COM ')).toBe('dev@pocket-fund.com')
  })

  it('never throws on null/undefined', () => {
    expect(normaliseEmail(null)).toBe('')
    expect(normaliseEmail(undefined)).toBe('')
  })
})

describe('findPersonByEmail', () => {
  it('matches regardless of the casing the user typed at login', () => {
    expect(findPersonByEmail(PEOPLE, 'DEV@POCKET-FUND.COM')?.id).toBe(1)
  })

  it('matches when the STORED row is the oddly-cased one', () => {
    // The real-world case: the people row was created from a capitalised
    // signup, and the user now logs in lower-case.
    expect(findPersonByEmail(PEOPLE, 'aum@pocket-fund.com')?.id).toBe(2)
  })

  it('tolerates surrounding whitespace', () => {
    expect(findPersonByEmail(PEOPLE, ' dev@pocket-fund.com ')?.id).toBe(1)
  })

  it('does not treat _ or % as wildcards', () => {
    // Guards against "fixing" this with .ilike: `_` is legal in an email local
    // part, and as a LIKE wildcard it would match the wrong person.
    const people = [{ id: 9, email: 'dev_shah@pocket-fund.com' }]
    expect(findPersonByEmail(people, 'devXshah@pocket-fund.com')).toBeUndefined()
    expect(findPersonByEmail(people, 'dev_shah@pocket-fund.com')?.id).toBe(9)
  })

  it('returns undefined rather than a bogus match for an unknown email', () => {
    expect(findPersonByEmail(PEOPLE, 'nobody@example.com')).toBeUndefined()
  })

  it('returns undefined for an empty email instead of matching a null row', () => {
    expect(findPersonByEmail(PEOPLE, '')).toBeUndefined()
    expect(findPersonByEmail(PEOPLE, null)).toBeUndefined()
  })

  it('survives a people list containing rows with no email', () => {
    expect(() => findPersonByEmail(PEOPLE, 'dev@pocket-fund.com')).not.toThrow()
  })
})
