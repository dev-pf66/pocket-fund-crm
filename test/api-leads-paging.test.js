// Guardrail: list endpoints page past PostgREST's 1,000-row cap.
//
// PostgREST returns at most 1,000 rows per select and NO error, so a single
// ?limit=10000 call used to return exactly 1,000. From 2026-10-15 the wiki's
// live numbers read 1,000 leads / 3 clients (real 1,075 / 10) and
// /api/activities returned 1,000 of 1,560. The fake below enforces the same
// cap, so an unpaged select fails here instead of silently in production.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const CAP = 1000
const h = vi.hoisted(() => ({ rows: [] }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from() {
      let lo = 0, hi = Infinity, head = false, filters = []
      const chain = {
        select(cols, opts) { head = Boolean(opts?.head); return chain },
        order() { return chain },
        limit(n) { hi = n - 1; return chain },
        range(a, z) { lo = a; hi = z; return chain },
        eq(col, v) { filters.push(r => r[col] === v); return chain },
        or() { return chain },
        then(resolve) {
          const all = h.rows.filter(r => filters.every(f => f(r)))
          const out = head
            ? { data: null, count: all.length, error: null }
            : { data: all.slice(lo, Math.min(hi + 1, lo + CAP)), error: null }
          return Promise.resolve(out).then(resolve)
        }
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

function res() {
  const r = { statusCode: null, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.end = () => r
  return r
}
const get = (query) => ({ method: 'GET', headers: { 'x-api-key': 'test-key' }, query })

beforeEach(() => {
  h.rows = Array.from({ length: 1075 }, (_, i) => ({
    id: i + 1, stage: i < 1065 ? 'outreach' : 'client', is_archived: false
  }))
})

describe('list endpoints past the 1,000-row cap', () => {
  it('GET /api/leads returns every row and an exact total', async () => {
    const r = res()
    await leads(get({ limit: '100000' }), r)
    expect(r.statusCode).toBe(200)
    expect(r.body.count).toBe(1075)
    expect(r.body.total).toBe(1075)
    expect(new Set(r.body.data.map(x => x.id)).size).toBe(1075)
  })

  it('GET /api/leads total follows the filters; limit still caps the rows', async () => {
    const r = res()
    await leads(get({ stage: 'client', limit: '5' }), r)
    expect(r.body.count).toBe(5)
    expect(r.body.total).toBe(10)
  })

  it('GET /api/activities returns every row', async () => {
    const r = res()
    await activities(get({ limit: '100000' }), r)
    expect(r.statusCode).toBe(200)
    expect(r.body.count).toBe(1075)
  })
})
