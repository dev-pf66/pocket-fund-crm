// owner_email / logged_by_email: the task tracker's out-of-office call log
// knows WHO made the call (the signed-in teammate's email) but not their CRM
// id — the two apps number people differently. Without these it could only
// send unowned leads, which POST /api/leads rejects, and unattributed
// activities, which the scoreboard (keyed on logged_by) credits to nobody.
// Siddhant's calls on 2026-10-15 and 10-19 all failed this way.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ ops: [], people: [] }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table) {
      const op = { table, payload: null }
      const chain = {
        select() { return chain },
        eq() { return chain },
        order() { return chain },
        range() {
          return Promise.resolve({ data: table === 'people' ? h.people : [], error: null })
        },
        single() {
          return Promise.resolve({ data: { id: 99, ...(op.payload || {}) }, error: null })
        },
        insert(payload) {
          op.payload = Array.isArray(payload) ? payload[0] : payload
          h.ops.push({ table, type: 'insert', payload: op.payload })
          return chain
        },
        update(payload) { h.ops.push({ table, type: 'update', payload }); return chain },
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve) }
      }
      return chain
    }
  })
}))

process.env.VITE_SUPABASE_URL = 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.CRM_API_KEY = 'test-key'

const { default: leads } = await import('../api/leads.js')
const { default: activities } = await import('../api/activities.js')

const inserts = (table) => h.ops.filter(o => o.table === table && o.type === 'insert')

function res() {
  const r = { statusCode: null, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.end = () => r
  return r
}
const post = (body) => ({ method: 'POST', headers: { 'x-api-key': 'test-key' }, query: {}, body })

beforeEach(() => {
  h.ops = []
  h.people = [
    { id: 24, email: 'Siddhant@Example.com', is_archived: false },
    { id: 7, email: 'gone@example.com', is_archived: true },
    { id: 30, email: 'twice@example.com', is_archived: false },
    { id: 31, email: 'TWICE@example.com', is_archived: false },
  ]
})

describe('POST /api/leads — owner_email', () => {
  it('resolves the owner case-insensitively and sets both owner fields', async () => {
    const r = res()
    await leads(post({ name: 'Chad Keiser', owner_email: ' siddhant@example.COM ' }), r)
    expect(r.statusCode).toBe(201)
    const row = inserts('crm_leads')[0].payload
    expect(row.assigned_to).toBe(24)
    expect(row.created_by).toBe(24)
    expect(row).not.toHaveProperty('owner_email')
  })

  it.each([
    ['nobody@example.com', /no CRM account/],
    ['gone@example.com', /archived/],
    ['twice@example.com', /matches 2/],
  ])('rejects %s and writes nothing', async (email, msg) => {
    const r = res()
    await leads(post({ name: 'X', owner_email: email }), r)
    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(msg)
    expect(inserts('crm_leads')).toHaveLength(0)
  })

  it('an explicit assigned_to wins over owner_email', async () => {
    const r = res()
    await leads(post({ name: 'X', assigned_to: 16, owner_email: 'siddhant@example.com' }), r)
    expect(r.statusCode).toBe(201)
    expect(inserts('crm_leads')[0].payload.assigned_to).toBe(16)
  })

  it('still rejects a lead with no owner of any kind', async () => {
    const r = res()
    await leads(post({ name: 'X', owner_email: '   ' }), r)
    expect(r.statusCode).toBe(400)
    expect(inserts('crm_leads')).toHaveLength(0)
  })
})

describe('POST /api/activities — logged_by_email', () => {
  it('credits the call to the resolved person', async () => {
    const r = res()
    await activities(post({ lead_id: 1713, activity_type: 'call', logged_by_email: 'siddhant@example.com' }), r)
    expect(r.statusCode).toBe(201)
    expect(inserts('crm_lead_activities')[0].payload.logged_by).toBe(24)
  })

  it('rejects an email with no CRM account and writes nothing', async () => {
    const r = res()
    await activities(post({ lead_id: 1713, activity_type: 'call', logged_by_email: 'nobody@example.com' }), r)
    expect(r.statusCode).toBe(400)
    expect(inserts('crm_lead_activities')).toHaveLength(0)
  })

  it('without an email it behaves as before', async () => {
    const r = res()
    await activities(post({ lead_id: 1713, activity_type: 'call' }), r)
    expect(r.statusCode).toBe(201)
    expect(inserts('crm_lead_activities')[0].payload.logged_by).toBe(null)
  })
})
