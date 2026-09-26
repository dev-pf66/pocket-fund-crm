// Guardrails for the bulk lead archive.
//
// The sweep flags several hundred production rows at once. It is reversible
// (is_archived + archived_at, never a delete), but the ways it can be quietly
// WRONG are all expensive, so each one is pinned here:
//
//  1. Sweeping a client. A won deal going quiet is an account-management
//     problem, not pipeline clutter, and burying it is how a renewal is missed.
//  2. The preview disagreeing with what runs. A preview nobody can trust is
//     worse than no preview, so both halves must decide via matchesSweep.
//  3. Archiving something with a live follow-up — i.e. a lead a human has
//     explicitly said they are still working.
//  4. A null last_activity_date making a lead immortal, so a stale import
//     nobody ever touched can never be swept.
//  5. Archived leads being excluded from duplicate detection, which would
//     re-import the entire archive as new leads on the next upload.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))

vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const {
  matchesSweep, sweepCriteria, lastTouchedOn, previewArchiveSweep,
  runArchiveSweep, NEVER_SWEEP_STAGES
} = await import('../src/lib/api/archive.js')

beforeEach(() => { vi.restoreAllMocks() })

const CUTOFF = '2026-06-28'
const base = { cutoff: CUTOFF, includeEngaged: true, keepScheduled: true }

function lead(over = {}) {
  return {
    id: 1,
    stage: 'outreach',
    is_archived: false,
    last_activity_date: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    next_follow_up_date: null,
    ...over
  }
}

// ---------------------------------------------------------------------------

describe('matchesSweep', () => {
  it('archives a lead untouched since before the cutoff', () => {
    expect(matchesSweep(lead(), base)).toBe(true)
  })

  it('leaves a lead touched after the cutoff alone', () => {
    expect(matchesSweep(lead({ last_activity_date: '2026-09-01T00:00:00Z' }), base)).toBe(false)
  })

  it('never sweeps a client, however long it has been quiet', () => {
    // The one rule with money directly attached.
    for (const stage of NEVER_SWEEP_STAGES) {
      expect(matchesSweep(lead({ stage, last_activity_date: '2020-01-01T00:00:00Z' }), base)).toBe(false)
    }
  })

  it('never re-sweeps a lead that is already archived', () => {
    // Otherwise a second sweep re-stamps archived_at and detaches the first
    // sweep's rows from their undo handle.
    expect(matchesSweep(lead({ is_archived: true }), base)).toBe(false)
  })

  it('leaves anything with a scheduled follow-up alone by default', () => {
    // A live reminder is a person saying "I am still working this". It has to
    // outrank the date heuristic.
    expect(matchesSweep(lead({ next_follow_up_date: '2026-10-01' }), base)).toBe(false)
  })

  it('sweeps a scheduled lead only when keepScheduled is switched off', () => {
    expect(matchesSweep(
      lead({ next_follow_up_date: '2026-10-01' }),
      { ...base, keepScheduled: false }
    )).toBe(true)
  })

  it('spares engaged stages when includeEngaged is off', () => {
    for (const stage of ['responded', 'meeting_booked', 'warm_active']) {
      expect(matchesSweep(lead({ stage }), { ...base, includeEngaged: false })).toBe(false)
      expect(matchesSweep(lead({ stage }), base)).toBe(true)
    }
  })

  it('ages a never-touched lead off created_at rather than treating it as immortal', () => {
    // A bulk import with no activity has last_activity_date null. Falling back
    // to created_at is what stops those rows living forever.
    const untouched = lead({ last_activity_date: null, created_at: '2026-01-01T00:00:00Z' })
    expect(lastTouchedOn(untouched)).toBe('2026-01-01')
    expect(matchesSweep(untouched, base)).toBe(true)
  })

  it('refuses a lead with no dates at all rather than guessing', () => {
    expect(matchesSweep(lead({ last_activity_date: null, created_at: null }), base)).toBe(false)
  })
})

describe('sweepCriteria', () => {
  it('rejects a non-positive window instead of archiving everything', () => {
    // `days: 0` would set the cutoff to today and sweep the live pipeline.
    expect(() => sweepCriteria({ days: 0 })).toThrow(/positive/)
    expect(() => sweepCriteria({ days: -5 })).toThrow(/positive/)
    expect(() => sweepCriteria({ days: 'soon' })).toThrow(/positive/)
  })

  it('defaults to 90 days', () => {
    expect(sweepCriteria().days).toBe(90)
  })
})

// ---------------------------------------------------------------------------

const ROWS = [
  { id: 1, stage: 'outreach', is_archived: false, last_activity_date: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', next_follow_up_date: null },
  { id: 2, stage: 'client', is_archived: false, last_activity_date: '2025-01-01T00:00:00Z', created_at: '2025-01-01T00:00:00Z', next_follow_up_date: null },
  { id: 3, stage: 'responded', is_archived: false, last_activity_date: '2026-09-20T00:00:00Z', created_at: '2026-01-01T00:00:00Z', next_follow_up_date: null },
  { id: 4, stage: 'warm_active', is_archived: false, last_activity_date: '2026-02-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', next_follow_up_date: '2026-10-01' }
]

function dbServing(rows) {
  return fakeSupabase(op => {
    if (op.table === 'crm_leads' && op.type === 'select') {
      // fetchAllRows pages; serve everything on page 1 and nothing after.
      const [from] = op.range || [0]
      return { data: from === 0 ? rows : [], error: null }
    }
    if (op.table === 'crm_leads' && op.type === 'update') {
      const ids = (op.filters.find(f => f[0] === 'in') || [])[2] || []
      return { data: ids.map(id => ({ id })), error: null }
    }
    return { data: [], error: null }
  })
}

describe('previewArchiveSweep', () => {
  it('counts only what matches, and breaks it down by stage', async () => {
    h.db = dbServing(ROWS)
    const p = await previewArchiveSweep({ days: 90 })
    // id 1 only: 2 is a client, 3 is recent, 4 has a follow-up scheduled.
    expect(p.ids).toEqual([1])
    expect(p.total).toBe(1)
    expect(p.scanned).toBe(4)
    expect(p.byStage).toEqual({ outreach: 1 })
  })

  it('asks the database only for live leads', async () => {
    h.db = dbServing(ROWS)
    await previewArchiveSweep({ days: 90 })
    const read = h.db.ops.find(o => o.table === 'crm_leads' && o.type === 'select')
    expect(read.filters).toContainEqual(['eq', 'is_archived', false])
  })

  it('writes nothing', async () => {
    h.db = dbServing(ROWS)
    await previewArchiveSweep({ days: 90 })
    expect(h.db.ops.filter(o => o.type === 'update')).toHaveLength(0)
  })

  it('samples oldest-first so the preview shows the least defensible rows', async () => {
    const rows = [
      { id: 10, stage: 'outreach', is_archived: false, last_activity_date: '2026-05-01T00:00:00Z', created_at: '2026-05-01T00:00:00Z' },
      { id: 11, stage: 'outreach', is_archived: false, last_activity_date: '2024-01-01T00:00:00Z', created_at: '2024-01-01T00:00:00Z' }
    ]
    h.db = dbServing(rows)
    const p = await previewArchiveSweep({ days: 90 })
    expect(p.sample.map(s => s.id)).toEqual([11, 10])
  })
})

describe('runArchiveSweep', () => {
  it('archives exactly the previewed set and never touches a client', async () => {
    h.db = dbServing(ROWS)
    const result = await runArchiveSweep({ days: 90 }, 7)

    const updates = h.db.ops.filter(o => o.table === 'crm_leads' && o.type === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].filters).toContainEqual(['in', 'id', [1]])
    expect(updates[0].payload.is_archived).toBe(true)
    expect(result.archived).toBe(1)
  })

  it('stamps every row in one sweep with the same archived_at, so undo can find them', async () => {
    // The undo handle. If the stamp varied per chunk, "undo this sweep" would
    // restore a fraction of it and silently leave the rest archived.
    const many = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1, stage: 'outreach', is_archived: false,
      last_activity_date: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z'
    }))
    h.db = dbServing(many)
    const result = await runArchiveSweep({ days: 90 })

    const updates = h.db.ops.filter(o => o.type === 'update')
    expect(updates.length).toBeGreaterThan(1) // chunked
    const stamps = new Set(updates.map(o => o.payload.archived_at))
    expect(stamps.size).toBe(1)
    expect(result.archivedAt).toBe([...stamps][0])
    expect(result.archived).toBe(250)
  })

  it('writes nothing when nothing matches', async () => {
    h.db = dbServing([ROWS[1], ROWS[2]]) // a client and a recent lead
    const result = await runArchiveSweep({ days: 90 })
    expect(result.archived).toBe(0)
    expect(result.archivedAt).toBeNull()
    expect(h.db.ops.filter(o => o.type === 'update')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------

describe('duplicate detection still sees archived leads', () => {
  it('does not filter is_archived out of the dedupe probe', async () => {
    // If archiving hid leads from dedupe, the next import would re-create
    // every archived lead as brand new — the one outcome archiving exists to
    // prevent. This asserts the absence of a filter, which is the kind of
    // thing a well-meaning cleanup adds.
    h.db = fakeSupabase(() => ({ data: [], error: null }))
    const { findDuplicateLead } = await import('../src/lib/api/leads.js')
    await findDuplicateLead({ linkedin_url: 'https://www.linkedin.com/in/someone/' })

    const probes = h.db.ops.filter(o => o.table === 'crm_leads' && o.type === 'select')
    expect(probes.length).toBeGreaterThan(0)
    for (const p of probes) {
      expect(p.filters.some(f => f[1] === 'is_archived')).toBe(false)
    }
  })
})
