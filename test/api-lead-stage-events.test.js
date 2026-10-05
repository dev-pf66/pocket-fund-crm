// Guardrail: GET /api/leads?view=stage_events serves the stage history.
//
// The tracker's goals dashboard counts "new clients this month" from this view.
// Counting client rows by updated_at instead counted any edit to an old client
// as a new one. Each row must carry the lead's CURRENT stage so a move that was
// later undone can be dropped by the caller.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ calls: [], rows: [] }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table) {
      const chain = {
        select(cols) { h.calls.push(['from', table], ['select', cols]); return chain },
        order(col, opts) { h.calls.push(['order', col, opts]); return chain },
        limit(n) { h.calls.push(['limit', n]); return chain },
        eq(col, v) { h.calls.push(['eq', col, v]); return chain },
        gte(col, v) { h.calls.push(['gte', col, v]); return chain },
        then(resolve) { return Promise.resolve({ data: h.rows, error: null }).then(resolve) }
      }
      return chain
    }
  })
}))

process.env.VITE_SUPABASE_URL = 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.CRM_API_KEY = 'test-key'

const { default: handler } = await import('../api/leads.js')

function res() {
  const r = { statusCode: null, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.end = () => r
  return r
}

const get = (query) => ({ method: 'GET', headers: { 'x-api-key': 'test-key' }, query })

beforeEach(() => { h.calls = []; h.rows = [] })

describe('GET /api/leads?view=stage_events', () => {
  it('reads crm_lead_stage_events, not crm_leads, with the filters applied', async () => {
    const r = res()
    await handler(get({ view: 'stage_events', to_stage: 'client', since: '2026-10-01', limit: '1000' }), r)

    expect(r.statusCode).toBe(200)
    expect(h.calls).toContainEqual(['from', 'crm_lead_stage_events'])
    expect(h.calls).toContainEqual(['eq', 'to_stage', 'client'])
    expect(h.calls).toContainEqual(['gte', 'changed_at', '2026-10-01'])
    expect(h.calls).toContainEqual(['limit', 1000])
    expect(h.calls.some(c => c[0] === 'from' && c[1] === 'crm_leads')).toBe(false)
  })

  it("flattens the lead's current stage onto each event", async () => {
    h.rows = [
      { id: 105, lead_id: 901, from_stage: 'warm_active', to_stage: 'client', changed_by: 1, changed_at: '2026-10-01T21:34:34Z',
        crm_leads: { name: 'Manas Sood', stage: 'client', is_archived: false } },
      { id: 50, lead_id: 737, from_stage: 'outreach', to_stage: 'client', changed_by: 16, changed_at: '2026-08-29T07:50:41Z',
        crm_leads: { name: 'Undone', stage: 'responded', is_archived: false } }
    ]
    const r = res()
    await handler(get({ view: 'stage_events', to_stage: 'client' }), r)

    expect(r.body.success).toBe(true)
    expect(r.body.count).toBe(2)
    expect(r.body.data[0]).toEqual({
      id: 105, lead_id: 901, from_stage: 'warm_active', to_stage: 'client', changed_by: 1,
      changed_at: '2026-10-01T21:34:34Z', lead_name: 'Manas Sood', current_stage: 'client', lead_is_archived: false
    })
    expect(r.body.data[1].current_stage).toBe('responded')
    expect(r.body.data[0]).not.toHaveProperty('crm_leads')
  })

  it('rejects a since that is not a date', async () => {
    const r = res()
    await handler(get({ view: 'stage_events', since: 'last month' }), r)
    expect(r.statusCode).toBe(400)
  })

  it('still requires the API key', async () => {
    const r = res()
    await handler({ method: 'GET', headers: {}, query: { view: 'stage_events' } }, r)
    expect(r.statusCode).toBe(401)
  })
})
