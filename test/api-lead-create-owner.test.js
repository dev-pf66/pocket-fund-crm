// Guardrail: POST /api/leads must not create an unowned lead.
//
// This endpoint whitelisted neither assigned_to nor created_by, so every lead
// created over HTTP landed with both NULL. 203 leads reached production that
// way and it was still happening — one was created unowned on 2026-09-27.
//
// An unowned lead is not merely untidy, it is INVISIBLE. RLS
// (migration 018, users_view_own_leads) grants SELECT on
// `admin OR created_by = me OR assigned_to = me`, so a lead with neither
// cannot be seen by any analyst, cannot appear on their board, in their
// queue, in their notification feed or in the weekly digest. It is in the
// database and nowhere else.
//
// CLAUDE.md designates this endpoint the PREFERRED access path for CRM data,
// so the /crm skill and every agent driving the CRM came through here. The
// browser paths have defaulted ownership to the creator since July 2026;
// this one silently did not.
//
// Rejecting is deliberate. The endpoint authenticates a machine with a shared
// key, so there is no logged-in user to infer an owner from — the caller has
// to say. Defaulting to a house account would file leads in a book nobody
// reads, which is the same bug wearing a name.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ ops: [] }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table) {
      const op = { table, type: 'select', payload: null }
      const chain = {
        select() { return chain },
        eq() { return chain },
        single() {
          return Promise.resolve({ data: { id: 99, ...(op.payload || {}) }, error: null })
        },
        insert(payload) {
          op.type = 'insert'
          op.payload = payload
          h.ops.push({ table, type: 'insert', payload })
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

const { default: handler } = await import('../api/leads.js')

const inserts = () => h.ops.filter(o => o.table === 'crm_leads' && o.type === 'insert')

function res() {
  const r = { statusCode: null, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.end = () => r
  return r
}

const post = (body) => ({
  method: 'POST',
  headers: { 'x-api-key': 'test-key' },
  query: {},
  body
})

beforeEach(() => { h.ops = [] })

describe('POST /api/leads — every lead gets an owner', () => {
  it('rejects a create with no owner, and writes nothing', async () => {
    const r = res()
    await handler(post({ name: 'Orphan Lead' }), r)

    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(/assigned_to/)
    expect(inserts()).toHaveLength(0)
  })

  it.each([[null], ['']])('treats %p as no owner at all', async (value) => {
    const r = res()
    await handler(post({ name: 'Orphan Lead', assigned_to: value }), r)

    expect(r.statusCode).toBe(400)
    expect(inserts()).toHaveLength(0)
  })

  it('accepts assigned_to and sets created_by to match', async () => {
    const r = res()
    await handler(post({ name: 'Jane Smith', assigned_to: 16 }), r)

    expect(r.statusCode).toBe(201)
    const row = inserts()[0].payload
    expect(row.assigned_to).toBe(16)
    expect(row.created_by).toBe(16)
    expect(row.assigned_date).toBeTruthy()
  })

  it('accepts created_by alone and fills assigned_to from it', async () => {
    // Both matter: the boards match on `created_by OR assigned_to`, but the
    // owner LABEL reads assigned_to, so a lead with only one shows as owned by
    // nobody inside its own owner's book.
    const r = res()
    await handler(post({ name: 'Jane Smith', created_by: 24 }), r)

    expect(r.statusCode).toBe(201)
    const row = inserts()[0].payload
    expect(row.assigned_to).toBe(24)
    expect(row.created_by).toBe(24)
  })

  it('keeps them distinct when the caller names both — a lead handed over on creation', async () => {
    const r = res()
    await handler(post({ name: 'Jane Smith', created_by: 1, assigned_to: 16 }), r)

    expect(r.statusCode).toBe(201)
    const row = inserts()[0].payload
    expect(row.created_by).toBe(1)
    expect(row.assigned_to).toBe(16)
  })

  it('does not mistake person id 0 for a missing owner', async () => {
    const r = res()
    await handler(post({ name: 'Jane Smith', assigned_to: 0 }), r)

    expect(r.statusCode).toBe(201)
    expect(inserts()[0].payload.assigned_to).toBe(0)
  })

  it('still rejects an empty name before it looks at ownership', async () => {
    const r = res()
    await handler(post({ assigned_to: 16 }), r)

    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(/name/)
    expect(inserts()).toHaveLength(0)
  })

  it('still authenticates', async () => {
    const r = res()
    await handler({ ...post({ name: 'Jane', assigned_to: 16 }), headers: {} }, r)

    expect(r.statusCode).toBe(401)
    expect(inserts()).toHaveLength(0)
  })
})
