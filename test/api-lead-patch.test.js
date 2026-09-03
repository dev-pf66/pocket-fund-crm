// Guardrail: the HTTP API's PATCH must record a stage change.
//
// crm_leads.stage is overwritten in place, so crm_lead_stage_events is the
// only evidence a lead ever moved — it backs the "moved forward this week"
// headline. CLAUDE.md designates this endpoint the PREFERRED access path for
// CRM data (the /crm skill and agents use it), so a move made through the
// front door that records nothing undercounts the metric with no error, no
// warning and nothing on screen that looks wrong. It shipped exactly that way
// and was caught in review.
//
// changed_by must stay null: an API key authenticates a machine, not a
// person, and attributing the move to someone would be a fabrication. The
// team strip renders those as "Unattributed".

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ ops: [], leadStage: 'outreach' }))

// Minimal PostgREST-shaped stub: records every write, serves the prior stage.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table) {
      const op = { table, type: null, payload: null }
      const chain = {
        select() { return chain },
        eq() { return chain },
        single() {
          if (op.type === 'select') return Promise.resolve({ data: { stage: h.leadStage }, error: null })
          return Promise.resolve({ data: { id: 42, stage: op.payload?.stage ?? h.leadStage }, error: null })
        },
        insert(payload) { h.ops.push({ table, type: 'insert', payload }); return Promise.resolve({ data: payload, error: null }) },
        update(payload) { op.type = 'update'; op.payload = payload; h.ops.push({ table, type: 'update', payload }); return chain },
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve) }
      }
      // Only terminal writes are recorded; from() itself is not an operation.
      op.type = 'select'
      return chain
    }
  })
}))

process.env.VITE_SUPABASE_URL = 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.CRM_API_KEY = 'test-key'

const { default: handler } = await import('../api/leads.js')

const events = () => h.ops.filter(o => o.table === 'crm_lead_stage_events' && o.type === 'insert')

function res() {
  const r = { statusCode: null, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.end = () => r
  return r
}

const patch = (body) => ({
  method: 'PATCH',
  headers: { 'x-api-key': 'test-key' },
  query: {},
  body
})

beforeEach(() => { h.ops = []; h.leadStage = 'outreach' })

describe('PATCH /api/leads — stage recording', () => {
  it('records an event when the stage changes', async () => {
    const r = res()
    await handler(patch({ id: 42, stage: 'responded' }), r)

    expect(r.statusCode).toBe(200)
    const ev = events()
    expect(ev).toHaveLength(1)
    expect(ev[0].payload).toMatchObject({
      lead_id: 42,
      from_stage: 'outreach',
      to_stage: 'responded',
      changed_by: null   // machine caller — never attributed to a person
    })
  })

  it('records nothing when the stage did not change', async () => {
    h.leadStage = 'responded'
    const r = res()
    await handler(patch({ id: 42, stage: 'responded' }), r)

    expect(r.statusCode).toBe(200)
    expect(events()).toHaveLength(0)
  })

  it('records nothing when the patch does not touch stage', async () => {
    const r = res()
    await handler(patch({ id: 42, notes: 'just a note' }), r)

    expect(r.statusCode).toBe(200)
    expect(events()).toHaveLength(0)
  })

  it('still authenticates', async () => {
    const r = res()
    await handler({ ...patch({ id: 42, stage: 'responded' }), headers: {} }, r)
    expect(r.statusCode).toBe(401)
    expect(events()).toHaveLength(0)
  })
})
