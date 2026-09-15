// Guardrails for the duplicate check on the interactive add paths.
//
// The CSV importer has deduped since day one; Quick Add and the Add Lead form
// never did. That is how Praveen Kumar and Edie Page each ended up filed twice
// — once in `warm_active` from a real conversation, once in `outreach` as a
// fresh cold lead — leaving an analyst free to cold-pitch a live thread.
//
// The two rules that matter and are easy to break:
//   1. URL variants must collapse. The probe is a server-side ILIKE on the
//      slug; the exact decision is made client-side on the normalised URL.
//   2. The ILIKE is deliberately loose and WILL over-match (a longer slug that
//      contains this one, `_` acting as a single-char wildcard). Every
//      candidate must be re-checked exactly, or the check reports the wrong
//      person as a duplicate and blocks a real lead.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))

vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { findDuplicateLead } = await import('../src/lib/api/leads.js')

const EXISTING = {
  id: 281,
  name: 'Praveen Kumar',
  firm_name: '',
  email: 'praveen@example.com',
  linkedin_url: 'https://www.linkedin.com/in/businesskumarpraveen/',
  stage: 'warm_active',
  assigned_to: 7
}

// Serves `rows` to every select, like a table containing exactly those rows.
function serving(rows) {
  return () => ({ data: rows })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('findDuplicateLead — LinkedIn', () => {
  it('matches across www / protocol / trailing-slash / query variants', async () => {
    for (const variant of [
      'https://linkedin.com/in/businesskumarpraveen',
      'https://www.linkedin.com/in/businesskumarpraveen/',
      'http://www.linkedin.com/in/businesskumarpraveen',
      'https://www.linkedin.com/in/businesskumarpraveen?trk=nav'
    ]) {
      h.db = fakeSupabase(serving([EXISTING]))
      const match = await findDuplicateLead({ linkedin_url: variant })
      expect(match, variant).toBeTruthy()
      expect(match.matchedOn).toBe('linkedin_url')
      expect(match.lead.id).toBe(281)
      // The caller shows stage and owner so you know what you'd be walking into.
      expect(match.lead.stage).toBe('warm_active')
      expect(match.lead.assigned_to).toBe(7)
    }
  })

  it('narrows the probe server-side instead of paging the table', async () => {
    h.db = fakeSupabase(serving([EXISTING]))
    await findDuplicateLead({ linkedin_url: 'https://linkedin.com/in/businesskumarpraveen' })
    const [op] = h.db.opsFor('crm_leads', 'select')
    expect(op.filters).toContainEqual(['ilike', 'linkedin_url', '%/in/businesskumarpraveen%'])
    expect(op.range).toBeNull()
  })

  it('rejects an ILIKE candidate whose slug merely contains the query slug', async () => {
    // /in/danchetritsmith is a different person from /in/danchetrit, but the
    // `%/in/danchetrit%` probe returns both.
    const other = { ...EXISTING, id: 999, linkedin_url: 'https://www.linkedin.com/in/danchetritsmith/' }
    h.db = fakeSupabase(serving([other]))
    const match = await findDuplicateLead({ linkedin_url: 'https://linkedin.com/in/danchetrit' })
    expect(match).toBeNull()
  })

  it('ignores a lead with no LinkedIn URL on file', async () => {
    h.db = fakeSupabase(serving([{ ...EXISTING, linkedin_url: null }]))
    const match = await findDuplicateLead({ linkedin_url: 'https://linkedin.com/in/businesskumarpraveen' })
    expect(match).toBeNull()
  })
})

describe('findDuplicateLead — email and name+firm', () => {
  it('matches email case-insensitively', async () => {
    h.db = fakeSupabase(serving([EXISTING]))
    const match = await findDuplicateLead({ email: '  PRAVEEN@Example.com ' })
    expect(match.matchedOn).toBe('email')
  })

  it('rejects an ILIKE email candidate that is not an exact match', async () => {
    // `_` is a single-character LIKE wildcard, so "a_b@x.com" pulls "axb@x.com".
    h.db = fakeSupabase(serving([{ ...EXISTING, email: 'axb@x.com' }]))
    const match = await findDuplicateLead({ email: 'a_b@x.com' })
    expect(match).toBeNull()
  })

  it('matches name only when the firm matches too', async () => {
    const atFirm = { ...EXISTING, firm_name: 'Acme Capital', linkedin_url: null, email: null }
    h.db = fakeSupabase(serving([atFirm]))
    expect((await findDuplicateLead({ name: 'praveen kumar', firm_name: 'ACME Capital' })).matchedOn)
      .toBe('name_firm')

    h.db = fakeSupabase(serving([atFirm]))
    // Same name, different firm — a genuinely different person, not a duplicate.
    expect(await findDuplicateLead({ name: 'Praveen Kumar', firm_name: 'Other Fund' })).toBeNull()
  })

  it('checks LinkedIn before email before name', async () => {
    h.db = fakeSupabase(serving([EXISTING]))
    const match = await findDuplicateLead({
      linkedin_url: 'https://linkedin.com/in/businesskumarpraveen',
      email: 'praveen@example.com',
      name: 'Praveen Kumar'
    })
    expect(match.matchedOn).toBe('linkedin_url')
    // Stops at the first hit rather than running all three probes.
    expect(h.db.opsFor('crm_leads', 'select')).toHaveLength(1)
  })
})

describe('findDuplicateLead — degrades instead of blocking', () => {
  it('returns null rather than throwing when the lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.db = fakeSupabase(() => { throw new Error('PostgREST exploded') })
    await expect(findDuplicateLead({ linkedin_url: 'https://linkedin.com/in/john-smith' }))
      .resolves.toBeNull()
  })

  it('does not query at all with nothing to match on', async () => {
    h.db = fakeSupabase(serving([EXISTING]))
    expect(await findDuplicateLead({})).toBeNull()
    expect(await findDuplicateLead()).toBeNull()
    expect(h.db.ops).toHaveLength(0)
  })
})
