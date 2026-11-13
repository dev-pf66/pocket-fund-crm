// Guardrail: the Today tab counts only people who have RESPONDED.
//
// Dev, 2026-11-13: Today should "only count people that have responded and
// beyond". A lead at `outreach` has never answered; it belongs to the outreach
// motion (Cold Calls, Tracker, Pipeline), not to anyone's day. Before this the
// queue weighted `outreach` at 2, follow-ups/overdue/unassigned read every
// non-terminal stage, and the header numbers counted people who never replied.
//
// The filter lives in SQL (`.in('stage', …)`), so this pins the stage filter
// on every lead read the tab makes. A refactor back to
// `.not('stage','in','(passed,client)')` lets `outreach` in again, silently.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { cacheClear } = await import('../src/lib/api/core.js')
const {
  getTodayQueue, getFollowUpsDue, getTodayCounters, getUnassignedLeads,
  TODAY_STAGE_WEIGHTS, TODAY_ENGAGED_STAGES, todayRank
} = await import('../src/lib/api/today.js')

const SETTINGS = { id: 1, cold_outreach_threshold: 3, warm_lead_threshold: 7, active_conversation_threshold: 14 }

function db(leads = []) {
  return fakeSupabase(op => {
    if (op.table === 'crm_lead_cover') return { data: [] }
    if (op.table === 'crm_settings') return { data: SETTINGS }
    if (op.table === 'crm_leads') return { data: leads }
    return { data: [] }
  })
}

const stageFilter = (op) => op.filters.find(f => f[1] === 'stage')

beforeEach(() => cacheClear())

describe('Today never reads un-responded leads', () => {
  it('the engaged set is responded and beyond, and excludes outreach', () => {
    expect(TODAY_ENGAGED_STAGES).toEqual(['responded', 'meeting_booked', 'warm_active'])
    expect(Object.keys(TODAY_STAGE_WEIGHTS)).not.toContain('outreach')
    expect(todayRank({ stage: 'outreach', lead_score: 99 })).toBe(0)
  })

  it.each([
    ['queue', () => getTodayQueue(1)],
    ['follow-ups', () => getFollowUpsDue(1)],
    ['overdue counter', () => getTodayCounters(1)],
    ['unassigned banner', () => getUnassignedLeads()]
  ])('%s filters stage IN a list that has no outreach', async (_name, run) => {
    h.db = db()
    await run()
    const ops = h.db.opsFor('crm_leads', 'select')
    expect(ops.length).toBeGreaterThan(0)
    for (const op of ops) {
      const f = stageFilter(op)
      expect(f?.[0]).toBe('in')
      expect(f[2]).not.toContain('outreach')
      expect(f[2]).toEqual(expect.arrayContaining(['responded', 'meeting_booked', 'warm_active']))
    }
  })

  it('follow-ups keep reach_out_later — they responded and asked for a date', async () => {
    h.db = db()
    await getFollowUpsDue(1)
    const [op] = h.db.opsFor('crm_leads', 'select')
    expect(stageFilter(op)[2]).toContain('reach_out_later')
  })
})
