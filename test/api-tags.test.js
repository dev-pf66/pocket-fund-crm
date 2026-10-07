// Guardrail: the HTTP API has a tags surface.
//
// Tags were readable/assignable/creatable from the browser (src/lib/api/misc.js,
// see test/tags.test.js) but the HTTP API — the "preferred access path for CRM
// data" per CLAUDE.md, and the only path available to an agent that can't hold
// a Supabase session — had no tags endpoint at all. The rules that made tags
// survive on the browser side apply here too: case-insensitive dedupe on
// create, idempotent bulk-assign, and no delete for a tag itself (only an
// unassign).
//
// This lives at GET/POST/PATCH/DELETE /api/leads?resource=tags, not its own
// api/tags.js file. A standalone file built and tested clean but failed every
// Vercel deploy (Oct 2026): the project's Hobby plan caps a deployment at 12
// Serverless Functions, api/ was already at exactly 12, and a 13th file broke
// production deploys with no code-level error to point at. See api/_tags.js.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))

// createClient() runs once at module import, before beforeEach has set h.db —
// so the mock must defer to h.db at CALL time (via closure), not capture its
// value at creation time, or every request would run against the stale null.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (...args) => h.db.from(...args)
  })
}))

process.env.VITE_SUPABASE_URL = 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.CRM_API_KEY = 'test-key'

const { default: handler } = await import('../api/leads.js')

const EXISTING = [
  { id: 1, name: 'Met at Conference', color: '#10b981' },
  { id: 2, name: 'Warm Intro', color: '#f59e0b' },
]

function serving({ tags = EXISTING, links = [] } = {}) {
  return (op) => {
    if (op.table === 'crm_tags' && op.type === 'insert') {
      return { data: { id: 99, ...(Array.isArray(op.payload) ? op.payload[0] : op.payload) } }
    }
    if (op.table === 'crm_tags' && op.type === 'update') {
      return { data: { id: Number(op.filters.find((f) => f[0] === 'eq')?.[2]) || 1, ...op.payload } }
    }
    if (op.table === 'crm_tags') return { data: tags }
    if (op.table === 'crm_lead_tags' && op.type === 'upsert') {
      return { data: (op.payload || []).map((r) => ({ lead_id: r.lead_id })) }
    }
    if (op.table === 'crm_lead_tags' && op.type === 'delete') {
      return { data: [] }
    }
    if (op.table === 'crm_lead_tags') return { data: links }
    return { data: [] }
  }
}

beforeEach(() => { h.db = fakeSupabase(serving()) })

function res() {
  const r = { statusCode: null, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.end = () => r
  return r
}

const AUTH = { 'x-api-key': 'test-key' }

// Every call goes through /api/leads with ?resource=tags — query is merged on
// top of that marker so callers only need to supply the params they care about.
const req = (overrides = {}) => ({
  headers: AUTH,
  body: {},
  ...overrides,
  query: { resource: 'tags', ...(overrides.query || {}) }
})

describe('/api/leads?resource=tags auth', () => {
  it('rejects a missing or wrong key', async () => {
    const r = res()
    await handler(req({ method: 'GET', headers: {} }), r)
    expect(r.statusCode).toBe(401)
  })
})

describe('GET /api/leads?resource=tags', () => {
  it('lists every tag', async () => {
    const r = res()
    await handler(req({ method: 'GET' }), r)
    expect(r.statusCode).toBe(200)
    expect(r.body.data.map((t) => t.name)).toEqual(['Met at Conference', 'Warm Intro'])
  })

  it('returns usage counts when asked', async () => {
    h.db = fakeSupabase(serving({ links: [{ tag_id: 1 }, { tag_id: 1 }, { tag_id: 2 }] }))
    const r = res()
    await handler(req({ method: 'GET', query: { with_usage: 'true' } }), r)
    expect(r.statusCode).toBe(200)
    const byName = Object.fromEntries(r.body.data.map((t) => [t.name, t.usage_count]))
    expect(byName).toEqual({ 'Met at Conference': 2, 'Warm Intro': 1 })
  })

  it('returns one lead\'s tags, skipping a link whose tag was deleted', async () => {
    h.db = fakeSupabase(serving({ links: [
      { tag: { id: 1, name: 'Met at Conference', color: '#10b981' } },
      { tag: null }
    ] }))
    const r = res()
    await handler(req({ method: 'GET', query: { lead_id: '10' } }), r)
    expect(r.statusCode).toBe(200)
    expect(r.body.data).toEqual([{ id: 1, name: 'Met at Conference', color: '#10b981' }])
  })
})

describe('POST /api/leads?resource=tags — create', () => {
  it('creates a tag with a trimmed name and an auto colour', async () => {
    const r = res()
    await handler(req({ method: 'POST', body: { name: '  London / Rollup Europe - London  ' } }), r)
    expect(r.statusCode).toBe(201)
    expect(r.body.data.name).toBe('London / Rollup Europe - London')
    expect(r.body.data.color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(r.body.created).toBe(true)
  })

  it('reuses an existing tag case-insensitively rather than erroring', async () => {
    const r = res()
    await handler(req({ method: 'POST', body: { name: 'warm intro' } }), r)
    expect(r.statusCode).toBe(200)
    expect(r.body.data.id).toBe(2)
    expect(r.body.created).toBe(false)
    expect(h.db.opsFor('crm_tags', 'insert')).toHaveLength(0)
  })

  it('rejects an empty name', async () => {
    const r = res()
    await handler(req({ method: 'POST', body: { name: '   ' } }), r)
    expect(r.statusCode).toBe(400)
  })
})

describe('POST /api/leads?resource=tags&action=assign — bulk assign', () => {
  it('applies one tag to many leads', async () => {
    const r = res()
    await handler(req({ method: 'POST', query: { action: 'assign' }, body: { tag_id: 1, lead_ids: [10, 11, 12] } }), r)
    expect(r.statusCode).toBe(200)
    expect(r.body).toMatchObject({ success: true, requested: 3, applied: 3 })
    expect(h.db.opsFor('crm_lead_tags', 'upsert')[0].payload).toEqual([
      { lead_id: 10, tag_id: 1 }, { lead_id: 11, tag_id: 1 }, { lead_id: 12, tag_id: 1 }
    ])
  })

  it('de-duplicates lead ids', async () => {
    const r = res()
    await handler(req({ method: 'POST', query: { action: 'assign' }, body: { tag_id: 1, lead_ids: [5, 5, 5] } }), r)
    expect(r.body.requested).toBe(1)
  })

  it('rejects a missing tag_id or empty lead_ids', async () => {
    const r1 = res()
    await handler(req({ method: 'POST', query: { action: 'assign' }, body: { lead_ids: [1] } }), r1)
    expect(r1.statusCode).toBe(400)

    const r2 = res()
    await handler(req({ method: 'POST', query: { action: 'assign' }, body: { tag_id: 1, lead_ids: [] } }), r2)
    expect(r2.statusCode).toBe(400)
  })
})

describe('PATCH /api/leads?resource=tags&id= — rename', () => {
  it('renames in place', async () => {
    const r = res()
    await handler(req({ method: 'PATCH', query: { id: '1' }, body: { name: '  Conference 2026 ' } }), r)
    expect(r.statusCode).toBe(200)
    expect(h.db.opsFor('crm_tags', 'update')[0].payload).toEqual({ name: 'Conference 2026' })
  })

  it('requires an id and a non-empty name', async () => {
    const r1 = res()
    await handler(req({ method: 'PATCH', query: {}, body: { name: 'x' } }), r1)
    expect(r1.statusCode).toBe(400)

    const r2 = res()
    await handler(req({ method: 'PATCH', query: { id: '1' }, body: { name: ' ' } }), r2)
    expect(r2.statusCode).toBe(400)
  })
})

describe('DELETE /api/leads?resource=tags — unassign only', () => {
  it('removes the lead/tag link', async () => {
    const r = res()
    await handler(req({ method: 'DELETE', query: { lead_id: '10', tag_id: '1' } }), r)
    expect(r.statusCode).toBe(200)
    expect(h.db.opsFor('crm_lead_tags', 'delete')).toHaveLength(1)
    expect(h.db.opsFor('crm_tags', 'delete')).toHaveLength(0)
  })

  it('requires both ids', async () => {
    const r = res()
    await handler(req({ method: 'DELETE', query: { lead_id: '10' } }), r)
    expect(r.statusCode).toBe(400)
  })
})

describe('resource=tags does not leak into plain /api/leads requests', () => {
  it('a GET without the resource flag still lists leads, not tags', async () => {
    h.db = fakeSupabase((op) => {
      if (op.table === 'crm_leads') return { data: [{ id: 1, name: 'Acme' }] }
      return { data: [] }
    })
    const r = res()
    await handler({ method: 'GET', headers: AUTH, query: {}, body: {} }, r)
    expect(r.statusCode).toBe(200)
    expect(r.body.data).toEqual([{ id: 1, name: 'Acme' }])
  })
})
