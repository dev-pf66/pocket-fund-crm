// Guardrail: archiving a person must not orphan their book.
//
// `setUserArchived` flips people.is_archived and touches nothing else. Every
// per-person surface in this app filters on `assigned_to`, so an archived owner's
// records go INVISIBLE-BUT-OWNED rather than unassigned — worse than unassigned,
// because the unassigned banner cannot see them either.
//
// Pravar (id 17) was archived and still held 1 lead and 2 sellers months later.
// Nobody saw them because nobody owned them in any way the UI could show.
//
// The rules:
//
//  1. `assigned_to` MOVES. That is "who is working this now", and an archived
//     person is working nothing.
//  2. `created_by` / `logged_by` / `changed_by` DO NOT. Those are history — who
//     added the lead, who sent that outreach — and rewriting them would falsify
//     past weeks' attribution in the weekly digest and the scoreboard. The person
//     who left did that work and keeps the credit.
//  3. Refuse a self-reassign and a missing target rather than writing a no-op that
//     reads as success.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { reassignOwnedRecords, countOwnedRecords } = await import('../src/lib/api/leads.js')

const serving = ({ leads = [{ id: 1 }], sellers = [{ id: 3 }, { id: 9 }] } = {}) => (op) => {
  if (op.table === 'crm_leads' && op.type === 'update') return { data: leads }
  if (op.table === 'crm_sellers' && op.type === 'update') return { data: sellers }
  return { data: [] }
}

const updateFor = (table) => h.db.opsFor(table, 'update').at(-1)

beforeEach(() => { vi.restoreAllMocks(); h.db = fakeSupabase(serving()) })

describe('reassignOwnedRecords', () => {
  it('moves leads and sellers, and reports how many of each', async () => {
    const moved = await reassignOwnedRecords(17, 24)
    expect(moved).toEqual({ leads: 1, sellers: 2 })
  })

  it('moves assigned_to and keeps the assignment metadata coherent', async () => {
    await reassignOwnedRecords(17, 24)
    const u = updateFor('crm_leads').payload

    expect(u.assigned_to).toBe(24)
    expect(u.assigned_by).toBe(24)
    // Not left showing a date from the previous owner's assignment.
    expect(u.assigned_date).toBeTruthy()
  })

  it('NEVER rewrites history — created_by, logged_by, changed_by are untouched', async () => {
    await reassignOwnedRecords(17, 24)
    for (const table of ['crm_leads', 'crm_sellers']) {
      const u = updateFor(table).payload
      for (const k of ['created_by', 'logged_by', 'changed_by']) {
        expect(u).not.toHaveProperty(k)
      }
    }
  })

  it('targets only the departing person\'s rows', async () => {
    await reassignOwnedRecords(17, 24)
    for (const table of ['crm_leads', 'crm_sellers']) {
      expect(updateFor(table).filters).toEqual(
        expect.arrayContaining([['eq', 'assigned_to', 17]])
      )
    }
  })

  it('refuses a self-reassign and writes nothing', async () => {
    await expect(reassignOwnedRecords(17, 17)).rejects.toThrow(/themselves/)
    expect(h.db.opsFor('crm_leads', 'update')).toHaveLength(0)
  })

  it.each([[null, 24], [17, null], [null, null]])(
    'refuses a missing person (%p -> %p) rather than a silent no-op',
    async (from, to) => {
      await expect(reassignOwnedRecords(from, to)).rejects.toThrow(/required/)
      expect(h.db.opsFor('crm_leads', 'update')).toHaveLength(0)
    })

  it('never deletes anything', async () => {
    await reassignOwnedRecords(17, 24)
    expect(h.db.opsFor('crm_leads', 'delete')).toHaveLength(0)
    expect(h.db.opsFor('crm_sellers', 'delete')).toHaveLength(0)
  })

  it('reports zero honestly when the person owned nothing', async () => {
    h.db = fakeSupabase(serving({ leads: [], sellers: [] }))
    expect(await reassignOwnedRecords(17, 24)).toEqual({ leads: 0, sellers: 0 })
  })
})

describe('countOwnedRecords', () => {
  it('counts without pulling rows, so the archive prompt is cheap', async () => {
    h.db = fakeSupabase(() => ({ data: [], count: 5 }))
    await countOwnedRecords(17)

    for (const op of h.db.opsFor('crm_leads', 'select')) {
      // head:true + count:exact — nothing crosses the wire to produce a number.
      expect(op.selectArgs).toBe('id')
    }
  })

  it('returns zeros for no person rather than throwing', async () => {
    expect(await countOwnedRecords(null)).toEqual({ leads: 0, sellers: 0 })
  })
})
