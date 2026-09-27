// Guardrails for lead ownership attribution.
//
// Two rules, both invisible in the code they protect:
//
//  1. THE OWNER LABEL FALLS BACK TO created_by. Every scoped lead query
//     matches on `created_by OR assigned_to`, but the surfaces that NAME the
//     owner read assigned_to alone. 132 leads — 41% of the table had no
//     assigned_to at all — therefore rendered as "Unassigned" inside their own
//     owner's book, and the obvious reading was that the CRM had lost them.
//     Migration 050 fixed the stored data; leadOwnerId is what stops it
//     recurring, because `PATCH /api/leads` accepts `assigned_to: null`.
//
//  2. A SWEEP RECORDS WHO RAN IT. runArchiveSweep has always accepted a
//     currentPersonId and returned it to the caller without writing it down,
//     so the one operation that flips several hundred rows at once was the one
//     with no name attached. archived_by (migration 051) is that name, and
//     restoring a lead must clear it — a live lead carrying an archiver reads
//     as though it were still archived.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))

vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { leadOwnerId } = await import('../src/lib/api/leads.js')
const { runArchiveSweep, setLeadArchived, undoArchiveSweep } = await import('../src/lib/api/archive.js')

beforeEach(() => { vi.restoreAllMocks() })

// ============================================================================
// 1. OWNERSHIP FALLBACK
// ============================================================================

describe('leadOwnerId', () => {
  it('prefers the assignee when there is one', () => {
    expect(leadOwnerId({ assigned_to: 5, created_by: 9 })).toBe(5)
  })

  it('falls back to the creator — this is the "Unassigned in my own book" bug', () => {
    expect(leadOwnerId({ assigned_to: null, created_by: 9 })).toBe(9)
  })

  it('reports nobody only when the database records nobody', () => {
    expect(leadOwnerId({ assigned_to: null, created_by: null })).toBeNull()
    expect(leadOwnerId({})).toBeNull()
    expect(leadOwnerId(null)).toBeNull()
    expect(leadOwnerId(undefined)).toBeNull()
  })

  it('does not mistake person id 0 for nobody', () => {
    // ?? not ||: a falsy-but-real id must survive. Guards the obvious "fix".
    expect(leadOwnerId({ assigned_to: 0, created_by: 9 })).toBe(0)
    expect(leadOwnerId({ assigned_to: null, created_by: 0 })).toBe(0)
  })
})

// ============================================================================
// 2. THE SWEEP SIGNS ITS WORK
// ============================================================================

/** Serves `rows` to every crm_leads read and echoes ids back on writes. */
function serving(rows) {
  return (op) => {
    if (op.table === 'crm_leads' && op.type === 'select') return { data: rows }
    if (op.table === 'crm_leads' && op.type === 'update') {
      return { data: op.single ? { id: 1, ...op.payload } : rows.map(r => ({ id: r.id })) }
    }
    return { data: [] }
  }
}

const STALE = {
  id: 1, name: 'Old', stage: 'outreach', is_archived: false,
  last_activity_date: '2026-01-01', created_at: '2026-01-01', next_follow_up_date: null
}

describe('archived_by', () => {
  it('a bulk sweep writes the actor onto every row, not just into its return value', async () => {
    h.db = fakeSupabase(serving([STALE]))
    const result = await runArchiveSweep({ days: 90 }, 7)

    expect(result.archived).toBe(1)
    const update = h.db.opsFor('crm_leads', 'update')[0]
    expect(update.payload.archived_by).toBe(7)
    expect(update.payload.is_archived).toBe(true)
    expect(update.payload.archived_at).toBeTruthy()
  })

  it('archiving one lead by hand records who did it', async () => {
    h.db = fakeSupabase(serving([{ id: 9 }]))
    await setLeadArchived(9, true, { reason: 'duplicate of #4', currentPersonId: 3 })

    expect(h.db.opsFor('crm_leads', 'update')[0].payload).toMatchObject({
      is_archived: true, archived_by: 3, archived_reason: 'duplicate of #4'
    })
  })

  it('restoring a lead clears the archiver — a live lead has none', async () => {
    h.db = fakeSupabase(serving([{ id: 9 }]))
    await setLeadArchived(9, false)

    expect(h.db.opsFor('crm_leads', 'update')[0].payload).toEqual({
      is_archived: false, archived_at: null, archived_reason: null, archived_by: null
    })
  })

  it('undoing a whole sweep clears the archiver too', async () => {
    h.db = fakeSupabase(serving([{ id: 1 }, { id: 2 }]))
    await undoArchiveSweep('2026-09-27T00:00:00.000Z')

    const update = h.db.opsFor('crm_leads', 'update')[0]
    expect(update.payload.archived_by).toBeNull()
    expect(update.payload.is_archived).toBe(false)
  })

  it('never deletes, whichever way the archive is driven', async () => {
    h.db = fakeSupabase(serving([STALE]))
    await runArchiveSweep({ days: 90 }, 7)
    await setLeadArchived(1, true, { currentPersonId: 7 })
    await setLeadArchived(1, false)
    await undoArchiveSweep('2026-09-27T00:00:00.000Z')

    expect(h.db.opsFor('crm_leads', 'delete')).toHaveLength(0)
  })
})
