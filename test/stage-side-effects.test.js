// Guardrails for the user-initiated stage change (moveLead) and its side
// effects — the other half of the bidirectional reply↔pipeline sync.
//
// The rules being pinned: dragging a lead to responded-or-later flips its
// latest un-replied outreach entry to 'replied' (so reply rate matches the
// pipeline), entering meeting_booked auto-logs the 'meeting' activity the
// Dashboard funnel counts, and neither side effect may ever fire twice or
// break the stage change itself.

import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))

vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { moveLead } = await import('../src/lib/api/leads.js')

// priorStage is what the pre-update select returns; pendingOutreach is the
// latest un-replied outreach entry, or [] for none.
function db({ priorStage, pendingOutreach = [{ id: 'o-1', status: 'sent' }] }) {
  const lead = { id: 'lead-1', stage: priorStage, assigned_to: 'p1' }
  return fakeSupabase((op) => {
    if (op.table === 'crm_leads' && op.type === 'select') return { data: lead }
    if (op.table === 'crm_leads' && op.type === 'update') {
      return { data: op.single ? { ...lead, ...op.payload } : [{ id: lead.id }] }
    }
    if (op.table === 'crm_outreach_log' && op.type === 'select') return { data: pendingOutreach }
    if (op.table === 'crm_outreach_log') return { data: [] }
    if (op.table === 'crm_lead_activities') return { data: { id: 'act-1' } }
    return { data: [] }
  })
}

const activityTypes = () =>
  h.db.opsFor('crm_lead_activities', 'insert').map(o => o.payload[0].activity_type)

describe('moveLead — reply↔pipeline sync', () => {
  it('flips the latest un-replied outreach entry when crossing into responded', async () => {
    h.db = db({ priorStage: 'cold_outreach' })
    await moveLead('lead-1', 'responded', 'p1')

    const update = h.db.opsFor('crm_outreach_log', 'update')[0]
    expect(update).toBeDefined()
    expect(update.payload.status).toBe('replied')
    expect(update.filters).toContainEqual(['eq', 'id', 'o-1'])
  })

  it('stamps replied_at on the back-synced row', async () => {
    // The reply metrics key off replied_at, not outreach_date (the SEND
    // date). This back-sync is a main way rows become 'replied', so leaving
    // the stamp null made those replies invisible to every "what moved"
    // number — a silent zero, which is the worst failure for a metric.
    h.db = db({ priorStage: 'cold_outreach' })
    await moveLead('lead-1', 'responded', 'p1')

    const update = h.db.opsFor('crm_outreach_log', 'update')[0]
    expect(update.payload.replied_at).toBeTruthy()
    expect(Number.isNaN(Date.parse(update.payload.replied_at))).toBe(false)
  })

  it('fires when jumping straight past responded to a later stage', async () => {
    h.db = db({ priorStage: 'cold_outreach' })
    await moveLead('lead-1', 'meeting_booked', 'p1')
    expect(h.db.opsFor('crm_outreach_log', 'update')).toHaveLength(1)
  })

  it('does NOT re-fire when the lead was already responded-or-later', async () => {
    // Otherwise every later drag re-marks another entry replied and the reply
    // rate inflates with each move.
    h.db = db({ priorStage: 'warm_lead' })
    await moveLead('lead-1', 'meeting_booked', 'p1')
    expect(h.db.opsFor('crm_outreach_log', 'update')).toHaveLength(0)
  })

  it('does not fire for a backwards move to an earlier stage', async () => {
    h.db = db({ priorStage: 'warm_lead' })
    await moveLead('lead-1', 'cold_outreach', 'p1')
    expect(h.db.opsFor('crm_outreach_log', 'update')).toHaveLength(0)
  })

  it('is a no-op when the lead has no un-replied outreach', async () => {
    h.db = db({ priorStage: 'cold_outreach', pendingOutreach: [] })
    await moveLead('lead-1', 'responded', 'p1')
    expect(h.db.opsFor('crm_outreach_log', 'update')).toHaveLength(0)
  })

  it('only ever flips one entry per crossing', async () => {
    h.db = db({
      priorStage: 'cold_outreach',
      pendingOutreach: [{ id: 'o-1', status: 'sent' }, { id: 'o-2', status: 'sent' }]
    })
    await moveLead('lead-1', 'responded', 'p1')
    expect(h.db.opsFor('crm_outreach_log', 'update')).toHaveLength(1)
    // ...and it asked the DB for exactly one row.
    expect(h.db.opsFor('crm_outreach_log', 'select')[0].limit).toBe(1)
  })
})

describe('moveLead — meeting auto-log', () => {
  it('auto-logs a meeting activity on entering meeting_booked', async () => {
    // This is what the Dashboard Funnel counts as a meeting.
    h.db = db({ priorStage: 'warm_lead' })
    await moveLead('lead-1', 'meeting_booked', 'p1')
    expect(activityTypes()).toContain('meeting')
  })

  it('does not re-log when the lead was already at meeting_booked', async () => {
    h.db = db({ priorStage: 'meeting_booked' })
    await moveLead('lead-1', 'meeting_booked', 'p1')
    expect(activityTypes()).not.toContain('meeting')
  })

  it('does not log a meeting for any other stage', async () => {
    h.db = db({ priorStage: 'cold_outreach' })
    await moveLead('lead-1', 'warm_lead', 'p1')
    expect(activityTypes()).not.toContain('meeting')
  })
})

describe('moveLead — the stage change itself', () => {
  it('writes the new stage and logs an audit note', async () => {
    h.db = db({ priorStage: 'cold_outreach' })
    const result = await moveLead('lead-1', 'warm_lead', 'p1')

    expect(h.db.opsFor('crm_leads', 'update')[0].payload).toEqual({ stage: 'warm_lead' })
    expect(result.stage).toBe('warm_lead')
    expect(activityTypes()).toContain('note')
  })

  it('survives a failing side effect — metrics must never break the move', async () => {
    h.db = fakeSupabase((op) => {
      const lead = { id: 'lead-1', stage: 'cold_outreach', assigned_to: 'p1' }
      if (op.table === 'crm_leads' && op.type === 'select') return { data: lead }
      if (op.table === 'crm_leads' && op.type === 'update') {
        return { data: op.single ? { ...lead, stage: 'responded' } : [{ id: 'lead-1' }] }
      }
      if (op.table === 'crm_outreach_log') throw new Error('outreach log unavailable')
      if (op.table === 'crm_lead_activities') return { data: { id: 'act-1' } }
      return { data: [] }
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await moveLead('lead-1', 'responded', 'p1')
    expect(result.stage).toBe('responded')
  })
})
