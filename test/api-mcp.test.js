// Guardrail: the remote MCP server at /api/mcp (dispatched from
// api/leads.js?resource=mcp — see api/_mcp.js for why it isn't its own file).
//
// This tests the MCP *plumbing*: the right tools are registered under the
// right names, a call actually reaches the real api/leads.js handler (not a
// reimplementation that could drift from it — see migration 049's lead_type
// bug for what that drift already cost once), and non-POST is rejected. It
// does NOT re-test business rules (stage/lead_type validation, pagination,
// tag case-insensitivity, ...) — those already have their own coverage where
// the logic lives, and a tool here is a thin wrapper that runs that same code.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import http from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args) => h.db.from(...args) })
}))

process.env.VITE_SUPABASE_URL = 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.CRM_API_KEY = 'test-key'

const { handleMcp } = await import('../api/_mcp.js')

const LEADS = [
  { id: 1, name: 'Jane Smith', firm_name: 'Acme Capital', stage: 'outreach', is_archived: false },
]

function serving({ leads = LEADS } = {}) {
  return (op) => {
    if (op.table === 'crm_leads') return { data: leads }
    return { data: [] }
  }
}

beforeEach(() => { h.db = fakeSupabase(serving()) })

// A real Streamable HTTP round trip (not a direct function call) over an
// actual loopback socket, so this exercises the transport the same way
// claude.ai or any other MCP client would — not just the handler in isolation.
async function withServer(run) {
  const server = http.createServer((req, res) => {
    res.status = (code) => { res.statusCode = code; return res }
    res.json = (body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); return res }

    if (req.method !== 'POST') return handleMcp(req, res)
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', async () => {
      req.body = raw ? JSON.parse(raw) : undefined
      await handleMcp(req, res)
    })
  })
  await new Promise((resolve) => server.listen(0, resolve))
  try {
    const { port } = server.address()
    return await run(port)
  } finally {
    server.close()
  }
}

async function connectedClient(port) {
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)))
  return client
}

describe('GET/POST/DELETE /api/mcp (via api/leads.js?resource=mcp)', () => {
  it('registers exactly the tools this surface promises', async () => {
    await withServer(async (port) => {
      const client = await connectedClient(port)
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name).sort()).toEqual([
        'assign_tag_to_leads', 'create_investor', 'create_lead', 'create_tag',
        'get_analytics', 'list_activities', 'list_investors', 'list_leads',
        'list_tags', 'log_activity', 'rename_tag', 'update_lead',
      ])
      await client.close()
    })
  })

  it('list_leads reaches the real api/leads.js handler, not a copy of its logic', async () => {
    await withServer(async (port) => {
      const client = await connectedClient(port)
      const result = await client.callTool({ name: 'list_leads', arguments: { limit: 10 } })
      expect(result.isError).toBe(false)
      const body = JSON.parse(result.content[0].text)
      expect(body).toMatchObject({ success: true, count: 1, data: [{ name: 'Jane Smith' }] })
      await client.close()
    })
  })

  it('surfaces the real handler\'s validation errors as tool errors, unchanged', async () => {
    await withServer(async (port) => {
      const client = await connectedClient(port)
      // No name, no owner — api/leads.js's own required-field checks, not
      // anything _mcp.js adds.
      const result = await client.callTool({ name: 'create_lead', arguments: { fields: {} } })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('name is required')
      await client.close()
    })
  })

  it('rejects non-POST with 405, not a silent SPA-shell-style 200', async () => {
    await withServer(async (port) => {
      const res = await fetch(`http://localhost:${port}/mcp`, { method: 'GET' })
      expect(res.status).toBe(405)
      const body = await res.json()
      expect(body.error.message).toMatch(/Method not allowed/)
    })
  })
})
