// Guardrail: partners (crm_partners) over HTTP and MCP (Oct 2026). Before
// this there was no endpoint at all, so the MCP connector could not see the
// partner pipeline. Pins: stage is validated against the SAME list the board
// uses (src/lib/partners.js), categories normalise to the board's keys, the
// list read pages past 1000, created_by comes from the MCP session's person,
// and there is no delete.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'
import { PARTNER_STAGE_KEYS } from '../src/lib/partners.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args) => h.db.from(...args) }),
}))

process.env.VITE_SUPABASE_URL = 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.CRM_API_KEY = 'test-key'

const { handlePartners } = await import('../api/_partners.js')

const PARTNERS = [
  { id: 1, name: 'Jane Creator', company_name: 'Acme Media', stage: 'potential', categories: ['creator'] },
  { id: 2, name: 'Prof. X', company_name: 'IIM', stage: 'reached_out', categories: ['professor'] },
]

beforeEach(() => {
  h.db = fakeSupabase((op) => {
    if (op.table !== 'crm_partners') return { data: [] }
    if (op.type === 'insert') return { data: { id: 3, ...op.payload } }
    if (op.type === 'update') return { data: { id: 1, ...op.payload } }
    if (op.single) return { data: PARTNERS[0] }
    return { data: PARTNERS }
  })
})

function call({ method = 'GET', query = {}, body } = {}) {
  const res = { statusCode: 200, body: undefined }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  return handlePartners({ method, query, body, headers: {} }, res).then(() => res)
}

describe('partners API (?resource=partners)', () => {
  it('lists every partner through fetchAllRows (paged, totally sorted)', async () => {
    const res = await call()
    expect(res.body).toMatchObject({ success: true, count: 2 })
    const op = h.db.opsFor('crm_partners', 'select')[0]
    expect(op.range).toEqual([0, 999])
    expect(op.calls.filter((c) => c === 'order')).toHaveLength(2)
  })

  it('filters by category using the board\'s key rule', async () => {
    await call({ query: { category: 'Creator' } })
    expect(h.db.opsFor('crm_partners', 'select')[0].filters).toContainEqual(['contains', 'categories', ['creator']])
  })

  it('searches name/company case-insensitively', async () => {
    const res = await call({ query: { search: 'iim' } })
    expect(res.body.data.map((p) => p.id)).toEqual([2])
  })

  it('rejects a stage the board does not have', async () => {
    const res = await call({ method: 'POST', body: { name: 'X', stage: 'won' } })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toContain(PARTNER_STAGE_KEYS.join(', '))
    expect(h.db.opsFor('crm_partners', 'insert')).toHaveLength(0)
  })

  it('creates with normalised, de-duplicated categories', async () => {
    const res = await call({ method: 'POST', body: { name: '  Big Fund ', categories: ['M&A Advisor', 'm_a advisor', 'Fund'], created_by: 7 } })
    expect(res.statusCode).toBe(201)
    expect(h.db.opsFor('crm_partners', 'insert')[0].payload).toMatchObject({
      name: 'Big Fund', categories: ['m_a_advisor', 'fund'], created_by: 7,
    })
  })

  it('requires a name', async () => {
    const res = await call({ method: 'POST', body: { categories: ['creator'] } })
    expect(res.statusCode).toBe(400)
  })

  it('patches allowed fields only — created_by is history', async () => {
    await call({ method: 'PATCH', query: { id: '1' }, body: { stage: 'in_conversation', created_by: 99, id: 1 } })
    expect(h.db.opsFor('crm_partners', 'update')[0].payload).toEqual({ stage: 'in_conversation' })
  })

  it('has no delete', async () => {
    const res = await call({ method: 'DELETE', query: { id: '1' } })
    expect(res.statusCode).toBe(405)
    expect(h.db.opsFor('crm_partners', 'delete')).toHaveLength(0)
  })
})
