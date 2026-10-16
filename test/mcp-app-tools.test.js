// Guardrail: the rest of the CRM as MCP tools (api/_mcp-tools.js, Oct 2026).
// These tools call the APP's own functions (api/_app.js → src/lib/api/*) so
// the trap-prone bookkeeping runs exactly as it does in the browser. Pinned
// here: the bookkeeping actually fires through the MCP path, the refusals
// that keep derived columns derived, attribution to the session's person,
// and that no delete tool exists.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import http from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null, lead: null, outreachRow: null }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (...args) => h.db.from(...args),
    rpc: async () => ({ error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}))

// The session gate has its own guardrails (test/mcp-session.test.js).
vi.mock('../api/_mcp-session.js', async (importOriginal) => ({
  ...(await importOriginal()),
  checkSession: async () => ({ ok: true, person: { id: 3, name: 'Gaurav', is_admin: false } }),
}))

const { handleMcp } = await import('../api/_mcp.js')

const DEAD_REASONS = [{ value: 'Not a fit' }, { value: 'Went quiet' }]

beforeEach(() => {
  h.lead = { id: 5, name: 'Jane Smith', firm_name: 'Acme', stage: 'meeting_booked' }
  h.outreachRow = { id: 70, outreach_type: 'linkedin_message', lead_id: 5, logged_by: 3 }
  h.db = fakeSupabase((op) => {
    if (op.table === 'crm_field_options') return { data: DEAD_REASONS }
    if (op.table === 'crm_outreach_log') {
      if (op.type === 'insert') return { data: { id: 71, ...op.payload[0] } }
      if (op.type === 'update') return { data: { ...h.outreachRow, ...op.payload } }
      if (op.calls.includes('maybeSingle')) return { data: h.outreachRow }
      if (op.selectArgs?.count) return { count: 0 }
      return { data: [] }
    }
    if (op.table === 'crm_leads') {
      if (op.type === 'update') return { data: op.single ? { ...h.lead, ...op.payload } : [{ id: h.lead.id }] }
      if (op.single) return { data: h.lead }
      return { data: [h.lead] }
    }
    if (op.table === 'crm_lead_activities' && op.type === 'insert') return { data: { id: 1, ...op.payload[0] } }
    if (op.table === 'crm_settings') return { data: {} }
    return { data: [] }
  })
})

async function withClient(run) {
  const server = http.createServer((req, res) => {
    res.status = (code) => { res.statusCode = code; return res }
    res.json = (body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); return res }
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', async () => {
      req.body = raw ? JSON.parse(raw) : undefined
      await handleMcp(req, res, { account: 'dev@pocket-fund.com' })
    })
  })
  await new Promise((resolve) => server.listen(0, resolve))
  const client = new Client({ name: 'test', version: '1.0.0' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${server.address().port}/mcp`)))
    return await run(client)
  } finally {
    await client.close()
    server.close()
  }
}

const call = (client, name, args) => client.callTool({ name, arguments: { session_id: 's', ...args } })
const activities = () => h.db.opsFor('crm_lead_activities', 'insert').map((o) => o.payload[0])

describe('MCP app tools', () => {
  it('exposes no delete / remove tool of any kind', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools()
      expect(tools.filter((t) => /^(delete|remove|unassign|unclaim|archive)_/.test(t.name))).toEqual([])
    })
  })

  it('update_lead moves stage through moveLead: leaving meeting_booked logs a meeting HELD, attributed to the session person', async () => {
    await withClient(async (client) => {
      const r = await call(client, 'update_lead', { id: 5, fields: { stage: 'warm_active' } })
      expect(r.isError).toBe(false)
      expect(activities()).toContainEqual(expect.objectContaining({ activity_type: 'meeting', logged_by: 3 }))
      expect(h.db.opsFor('crm_lead_stage_events', 'insert')[0].payload)
        .toMatchObject({ from_stage: 'meeting_booked', to_stage: 'warm_active', changed_by: 3 })
    })
  })

  it('update_lead rejects an unknown stage before touching anything', async () => {
    await withClient(async (client) => {
      const r = await call(client, 'update_lead', { id: 5, fields: { stage: 'won' } })
      expect(r.isError).toBe(true)
      expect(h.db.opsFor('crm_leads', 'update')).toHaveLength(0)
    })
  })

  it('log_outreach as replied runs the reply → pipeline sync (forward-only advance)', async () => {
    h.lead = { ...h.lead, stage: 'outreach' }
    await withClient(async (client) => {
      const r = await call(client, 'log_outreach', { fields: { lead_id: 5, outreach_type: 'linkedin_message', status: 'replied', logged_by: 99 } })
      expect(r.isError).toBe(false)
      const row = h.db.opsFor('crm_outreach_log', 'insert')[0].payload[0]
      expect(row).toMatchObject({ logged_by: 3, lead_name: 'Jane Smith' })
      expect(row.replied_at).toBeTruthy()
      expect(h.db.opsFor('crm_leads', 'update').some((o) => o.payload.stage === 'responded')).toBe(true)
    })
  })

  it('log_outreach refuses a phone call; update_outreach refuses a call row', async () => {
    h.outreachRow = { ...h.outreachRow, outreach_type: 'phone_call' }
    await withClient(async (client) => {
      expect((await call(client, 'log_outreach', { fields: { lead_id: 5, outreach_type: 'phone_call' } })).isError).toBe(true)
      expect((await call(client, 'update_outreach', { id: 70, fields: { status: 'replied' } })).isError).toBe(true)
      expect(h.db.opsFor('crm_outreach_log', 'update')).toHaveLength(0)
    })
  })

  it('log_call derives status from the outcome and never takes a typed one', async () => {
    h.lead = { ...h.lead, stage: 'outreach' }
    await withClient(async (client) => {
      await call(client, 'log_call', { fields: { lead_id: 5, call_outcome: 'interested', status: 'sent', logged_by: 99 } })
      const row = h.db.opsFor('crm_outreach_log', 'insert')[0].payload[0]
      expect(row).toMatchObject({ outreach_type: 'phone_call', status: 'replied', connected: true, logged_by: 3 })
    })
  })

  it('log_call rejects an outcome outside the vocabulary', async () => {
    await withClient(async (client) => {
      const r = await call(client, 'log_call', { fields: { lead_id: 5, call_outcome: 'conversation' } })
      expect(r.isError).toBe(true)
      expect(h.db.opsFor('crm_outreach_log', 'insert')).toHaveLength(0)
    })
  })

  it('dispose_lead dead needs a reason from the admin-managed list', async () => {
    await withClient(async (client) => {
      const bad = await call(client, 'dispose_lead', { id: 5, disposition: 'dead', reason: 'meh' })
      expect(bad.isError).toBe(true)
      expect(bad.content[0].text).toContain('Not a fit')
      const ok = await call(client, 'dispose_lead', { id: 5, disposition: 'dead', reason: 'Not a fit' })
      expect(ok.isError).toBe(false)
      expect(h.db.opsFor('crm_leads', 'update')[0].payload).toMatchObject({ stage: 'passed', dead_reason: 'Not a fit', disposed_by: 3 })
    })
  })

  it('pipelines reject a stage their board does not have, and stamp created_by', async () => {
    await withClient(async (client) => {
      expect((await call(client, 'create_seller', { fields: { name: 'Biz', stage: 'won' } })).isError).toBe(true)
      expect((await call(client, 'update_italy_contact', { id: 1, fields: { contact_type: 'lawyer' } })).isError).toBe(true)
      await call(client, 'create_seller', { fields: { name: 'Biz', stage: 'sourced', created_by: 99 } })
      expect(h.db.opsFor('crm_sellers', 'insert')[0].payload[0]).toMatchObject({ created_by: 3, stage: 'sourced' })
    })
  })

  it('claim_call claims for the session person only', async () => {
    await withClient(async (client) => {
      await call(client, 'claim_call', { id: 70 })
      const upd = h.db.opsFor('crm_outreach_log', 'update')[0]
      expect(upd.payload).toMatchObject({ logged_by: 3 })
      expect(upd.filters).toContainEqual(['is', 'logged_by', null])
    })
  })

  it('a thrown DB error comes back as a readable tool error', async () => {
    h.db = fakeSupabase(() => ({ data: null, error: { message: 'boom' } }))
    await withClient(async (client) => {
      const r = await call(client, 'list_sellers', {})
      expect(r.isError).toBe(true)
      expect(r.content[0].text).toMatch(/boom/)
    })
  })
})
