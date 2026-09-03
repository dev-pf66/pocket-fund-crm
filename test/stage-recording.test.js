// Guardrails for the paths that must RECORD a stage change.
//
// crm_leads.stage is overwritten on every change, so crm_lead_stage_events is
// the only record that a lead ever moved — it backs the "moved forward this
// week" headline on Today and Dashboard. A path that changes stage without
// writing an event doesn't error, doesn't warn, and doesn't look wrong: the
// number is simply low. That's the failure mode these pin.
//
// One of these was shipped broken and found in review: the three paths in
// leads.js must not write an event when the stage didn't actually change, or
// the number inflates instead.
//
// markLeadReachedOut no longer moves the stage at all — new_lead and
// cold_outreach merged into one 'outreach' stage (Sept 2026), so working the
// Outreach Queue is tracked by the crm_outreach_log row itself, not a stage
// transition. It must NOT write a stage event.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))

vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { markLeadReachedOut } = await import('../src/lib/api/queue.js')
const { moveLead, advanceLeadStage } = await import('../src/lib/api/leads.js')

const stageEvents = () => h.db.opsFor('crm_lead_stage_events', 'insert').map(o => o.payload)

function responder(lead) {
  return (op) => {
    if (op.table === 'crm_leads' && op.type === 'select') return { data: lead }
    if (op.table === 'crm_leads' && op.type === 'update') {
      return { data: op.single ? { ...lead, ...op.payload } : [{ id: lead.id }] }
    }
    if (op.table === 'crm_lead_activities') return { data: { id: 'act-1' } }
    if (op.table === 'crm_outreach_log') return { data: { id: 'o-1' } }
    return { data: [] }
  }
}

beforeEach(() => { vi.restoreAllMocks() })

describe('markLeadReachedOut — no longer a stage transition', () => {
  it('logs outreach but writes no stage event — outreach queue tracks this via crm_outreach_log now', async () => {
    const lead = { id: 'lead-1', name: 'Probe', stage: 'outreach', firm_name: 'Co' }
    h.db = fakeSupabase(responder(lead))

    await markLeadReachedOut(lead, 'p1', 'Pushkar')

    expect(stageEvents()).toHaveLength(0)
    expect(h.db.opsFor('crm_outreach_log', 'insert')).toHaveLength(1)
  })
})

describe('recording does not fire on a non-move', () => {
  it('advanceLeadStage writes no event when the lead is already past the target', async () => {
    // Forward-only: it returns the lead untouched, so there is nothing to record.
    h.db = fakeSupabase(responder({ id: 'lead-3', stage: 'warm_active' }))
    await advanceLeadStage('lead-3', 'responded', 'p1')
    expect(stageEvents()).toHaveLength(0)
  })

  it('advanceLeadStage writes no event for a terminal lead', async () => {
    h.db = fakeSupabase(responder({ id: 'lead-4', stage: 'passed' }))
    await advanceLeadStage('lead-4', 'responded', 'p1')
    expect(stageEvents()).toHaveLength(0)
  })
})

describe('moveLead', () => {
  it('records the transition with both ends', async () => {
    h.db = fakeSupabase(responder({ id: 'lead-5', stage: 'responded', assigned_to: 'p1' }))
    await moveLead('lead-5', 'meeting_booked', 'p1')

    expect(stageEvents()[0]).toMatchObject({
      lead_id: 'lead-5',
      from_stage: 'responded',
      to_stage: 'meeting_booked',
      changed_by: 'p1'
    })
  })
})
