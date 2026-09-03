// Guardrails for the forward-only pipeline machinery.
//
// These encode product decisions, not just behavior — "automation never
// regresses a lead", "automation never touches client/passed", "the automation
// path deliberately skips the side effects so replies aren't double-counted".
// They're the rules an agent editing leads.js is most likely to break, and
// nothing else in the repo checks them.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

// Hoisted so the vi.mock factory below can see it.
const h = vi.hoisted(() => ({ db: null }))

vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { advanceLeadStage } = await import('../src/lib/api/leads.js')

// Responder that serves one lead row and accepts every write.
function withLead(lead) {
  return (op) => {
    if (op.table === 'crm_leads' && op.type === 'select') return { data: lead }
    if (op.table === 'crm_leads' && op.type === 'update') {
      // logActivity's stamp does .select('id') with no .single()
      return { data: op.single ? { ...lead, ...op.payload } : [{ id: lead.id }] }
    }
    if (op.table === 'crm_lead_activities') return { data: { id: 'act-1' } }
    return { data: [] }
  }
}

const LEAD = { id: 'lead-1', stage: 'outreach', assigned_to: 'p1' }

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('advanceLeadStage — forward-only', () => {
  it('moves a lead forward along STAGE_ORDER', async () => {
    h.db = fakeSupabase(withLead(LEAD))
    const result = await advanceLeadStage('lead-1', 'responded', 'p1')

    const update = h.db.opsFor('crm_leads', 'update')[0]
    expect(update.payload).toEqual({ stage: 'responded' })
    expect(result.stage).toBe('responded')
  })

  it('never regresses a lead that is already further along', async () => {
    h.db = fakeSupabase(withLead({ ...LEAD, stage: 'meeting_booked' }))
    const result = await advanceLeadStage('lead-1', 'responded', 'p1')

    expect(h.db.opsFor('crm_leads', 'update')).toHaveLength(0)
    expect(result.stage).toBe('meeting_booked')
  })

  it('is a no-op when the lead is already at the target stage', async () => {
    h.db = fakeSupabase(withLead({ ...LEAD, stage: 'responded' }))
    await advanceLeadStage('lead-1', 'responded', 'p1')
    expect(h.db.opsFor('crm_leads', 'update')).toHaveLength(0)
  })

  it('never touches a client', async () => {
    h.db = fakeSupabase(withLead({ ...LEAD, stage: 'client' }))
    const result = await advanceLeadStage('lead-1', 'meeting_booked', 'p1')
    expect(h.db.opsFor('crm_leads', 'update')).toHaveLength(0)
    expect(result.stage).toBe('client')
  })

  it('never touches a passed lead — passed is terminal and outside STAGE_ORDER', async () => {
    h.db = fakeSupabase(withLead({ ...LEAD, stage: 'passed' }))
    const result = await advanceLeadStage('lead-1', 'warm_active', 'p1')
    expect(h.db.opsFor('crm_leads', 'update')).toHaveLength(0)
    expect(result.stage).toBe('passed')
  })

  it('skips the stage side effects — this path must not flip outreach to replied', async () => {
    // The whole reason advanceLeadStage is low-level: it is called BY the
    // reply→pipeline sync, so running the side effects here would mark the
    // outreach entry replied a second time and double-count the reply rate.
    h.db = fakeSupabase(withLead(LEAD))
    await advanceLeadStage('lead-1', 'meeting_booked', 'p1')

    expect(h.db.opsFor('crm_outreach_log', 'update')).toHaveLength(0)
    // ...and it must not auto-log the 'meeting' activity that moveLead does.
    const activities = h.db.opsFor('crm_lead_activities', 'insert')
    const types = activities.map(o => o.payload[0].activity_type)
    expect(types).not.toContain('meeting')
  })

  it('leaves an audit note naming the automation', async () => {
    h.db = fakeSupabase(withLead(LEAD))
    await advanceLeadStage('lead-1', 'responded', 'p1')

    const note = h.db.opsFor('crm_lead_activities', 'insert')[0].payload[0]
    expect(note.activity_type).toBe('note')
    expect(note.notes).toMatch(/auto/i)
    expect(note.logged_by).toBe('p1')
  })
})
