// Guardrail: /api/mcp must be reachable from claude.ai, which can only do
// OAuth — it cannot send x-api-key. The first cut answered a bare 401 with no
// WWW-Authenticate and no metadata, so claude.ai read the SPA's index.html as
// OAuth metadata and failed at "Couldn't register with ... sign-in service".
// See api/_mcp-auth.js.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null, users: {} }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (...args) => h.db.from(...args),
    auth: {
      getUser: async (jwt) => h.users[jwt]
        ? { data: { user: h.users[jwt] }, error: null }
        : { data: { user: null }, error: { message: 'invalid JWT' } },
    },
  }),
}))

process.env.VITE_SUPABASE_URL = 'https://proj.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.CRM_API_KEY = 'test-key'

const { default: leadsHandler } = await import('../api/leads.js')

const PEOPLE = [
  { id: 1, email: 'dev@pocket-fund.com', is_archived: false },
  { id: 2, email: 'gone@pocket-fund.com', is_archived: true },
]

beforeEach(() => {
  h.db = fakeSupabase((op) => (op.table === 'people' ? { data: PEOPLE } : { data: [] }))
  h.users = {
    'jwt-dev': { id: 'u1', email: 'Dev@Pocket-Fund.com' },
    'jwt-gone': { id: 'u2', email: 'gone@pocket-fund.com' },
    'jwt-stranger': { id: 'u3', email: 'someone@else.com' },
  }
})

function call({ method = 'POST', query = {}, headers = {} } = {}) {
  const res = { statusCode: 200, headers: {}, body: undefined }
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  res.end = () => res
  const req = { method, query, headers: { host: 'pocket-fund-crm.vercel.app', ...headers }, body: {} }
  return { req, res }
}

// handleMcp is stubbed — this file tests the gate in front of it, not the
// MCP server itself (that is test/api-mcp.test.js).
vi.mock('../api/_mcp.js', () => ({
  handleMcp: (req, res) => res.status(200).json({ reached: 'mcp' }),
}))

describe('/api/mcp auth (claude.ai OAuth path)', () => {
  it('serves protected-resource metadata without any credentials, pointing at Supabase Auth', async () => {
    const { req, res } = call({ method: 'GET', query: { resource: 'oauth-protected-resource' } })
    await leadsHandler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(expect.objectContaining({
      resource: 'https://pocket-fund-crm.vercel.app/api/mcp',
      authorization_servers: ['https://proj.supabase.co/auth/v1'],
    }))
  })

  it('answers an unauthenticated MCP call with 401 + WWW-Authenticate naming the metadata URL', async () => {
    const { req, res } = call({ query: { resource: 'mcp' } })
    await leadsHandler(req, res)
    expect(res.statusCode).toBe(401)
    expect(res.headers['www-authenticate']).toBe(
      'Bearer resource_metadata="https://pocket-fund-crm.vercel.app/.well-known/oauth-protected-resource"'
    )
  })

  it('still accepts the shared x-api-key', async () => {
    const { req, res } = call({ query: { resource: 'mcp' }, headers: { 'x-api-key': 'test-key' } })
    await leadsHandler(req, res)
    expect(res.body).toEqual({ reached: 'mcp' })
  })

  it('accepts a Supabase bearer token for a live CRM person (email matched case-insensitively)', async () => {
    const { req, res } = call({ query: { resource: 'mcp' }, headers: { authorization: 'Bearer jwt-dev' } })
    await leadsHandler(req, res)
    expect(res.body).toEqual({ reached: 'mcp' })
  })

  it('401s an invalid token so the client re-runs OAuth', async () => {
    const { req, res } = call({ query: { resource: 'mcp' }, headers: { authorization: 'Bearer nope' } })
    await leadsHandler(req, res)
    expect(res.statusCode).toBe(401)
    expect(res.headers['www-authenticate']).toMatch(/resource_metadata=/)
  })

  it('403s an archived person — the app bounces them, so MCP must too', async () => {
    const { req, res } = call({ query: { resource: 'mcp' }, headers: { authorization: 'Bearer jwt-gone' } })
    await leadsHandler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('403s a valid login with no people row', async () => {
    const { req, res } = call({ query: { resource: 'mcp' }, headers: { authorization: 'Bearer jwt-stranger' } })
    await leadsHandler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('does NOT let a bearer token into the rest of /api/leads — that stays api-key only', async () => {
    const { req, res } = call({ method: 'GET', headers: { authorization: 'Bearer jwt-dev' } })
    await leadsHandler(req, res)
    expect(res.statusCode).toBe(401)
  })
})
