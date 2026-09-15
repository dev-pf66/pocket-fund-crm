// Guardrail: the LinkedIn bulk importer must never invent a name, and must
// never collapse a batch onto one indistinguishable name.
//
// `nameFromLinkedInUrl` was taught to return '' rather than guess at a
// run-together slug ("michaeljmostek" → not "Michaeljmostek"). The importer's
// fallback was the literal 'Unknown', which is worse than a guess: every
// unsplittable slug in the paste lands under the SAME name, so the queue shows
// a column of "Unknown" and nobody can tell one from another. Twelve leads
// reached production that way before anyone noticed.
//
// The rule: split the slug, else file them under '@slug' — unique, visibly
// unresolved, and still carrying the slug for a later backfill.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))

vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { bulkCreateLeads } = await import('../src/lib/api/queue.js')

// Empty table: every select returns nothing, so nothing dedupes away and the
// insert payload is exactly what the importer decided to write.
function emptyTable() {
  return fakeSupabase(op => (op.type === 'insert' ? { data: op.payload } : { data: [] }))
}

/** The rows the importer actually tried to insert into crm_leads. */
function insertedLeads(db) {
  return db.ops
    .filter(o => o.table === 'crm_leads' && o.type === 'insert')
    .flatMap(o => o.payload)
}

beforeEach(() => {
  vi.restoreAllMocks()
  h.db = emptyTable()
})

describe('bulkCreateLeads — naming', () => {
  it('splits a clean slug into a real name', async () => {
    await bulkCreateLeads(['https://www.linkedin.com/in/john-smith/'], null, 7)
    expect(insertedLeads(h.db).map(l => l.name)).toEqual(['John Smith'])
  })

  it('files an unsplittable slug under @slug, never "Unknown"', async () => {
    await bulkCreateLeads(['https://www.linkedin.com/in/michaeljmostek/'], null, 7)
    const [lead] = insertedLeads(h.db)
    expect(lead.name).toBe('@michaeljmostek')
    expect(lead.name).not.toBe('Unknown')
  })

  it('keeps every unsplittable lead in a batch distinguishable', async () => {
    // The actual failure: a paste of run-together slugs became a wall of
    // identical "Unknown" rows.
    await bulkCreateLeads([
      'https://www.linkedin.com/in/michaeljmostek/',
      'https://www.linkedin.com/in/varunbhambhani/',
      'https://www.linkedin.com/in/jesseypark',
      'https://www.linkedin.com/in/mhatremandar/?skipRedirect=true'
    ], null, 7)

    const names = insertedLeads(h.db).map(l => l.name)
    expect(names).toEqual([
      '@michaeljmostek',
      '@varunbhambhani',
      '@jesseypark',
      '@mhatremandar'
    ])
    expect(new Set(names).size).toBe(names.length)
    expect(names).not.toContain('Unknown')
  })

  it('never writes the fabricated columns the enrichment used to invent', async () => {
    await bulkCreateLeads(['https://www.linkedin.com/in/akshaypatel15/'], null, 7)
    const [lead] = insertedLeads(h.db)
    for (const column of ['linkedin_headline', 'current_position', 'past_experience', 'education']) {
      expect(lead).not.toHaveProperty(column)
    }
  })
})
