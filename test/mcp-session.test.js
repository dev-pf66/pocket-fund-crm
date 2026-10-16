// Guardrail: every MCP conversation must ask who is using the CRM (Dev, Oct
// 2026 — several people share his Claude account, so the OAuth login never
// says who is at the keyboard). No CRM tool runs without a live session; a
// session ends on end_session or after MCP_SESSION_IDLE_MINUTES idle, and
// then the next call is refused until someone says who they are again.
// Writes made in a session are attributed to its person. See
// api/_mcp-session.js.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import http from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args) => h.db.from(...args) }),
}))

process.env.VITE_SUPABASE_URL = 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.CRM_API_KEY = 'test-key'

const { handleMcp } = await import('../api/_mcp.js')
const { resolvePerson, MCP_SESSION_IDLE_MINUTES } = await import('../api/_mcp-session.js')

const PEOPLE = [
  { id: 1, name: 'Dev Shah', email: 'dev@pocket-fund.com', is_archived: false },
  { id: 2, name: 'Aum Patel', email: 'aum@pocket-fund.com', is_archived: false },
  { id: 3, name: 'Gaurav', email: 'gaurav@pocket-fund.com', is_archived: false },
  { id: 4, name: 'Pravar', email: 'pravar@pocket-fund.com', is_archived: true },
  { id: 5, name: 'dev', email: 'dev+localtest@pocket-fund.com', is_archived: false },
  { id: 6, name: 'Aum Shah', email: 'aum.s@pocket-fund.com', is_archived: false },
]

describe('resolvePerson — matching the human\'s answer to one person', () => {
  it('matches exact email, exact name, or a unique first name', () => {
    expect(resolvePerson(PEOPLE, 'DEV@pocket-fund.com').person.id).toBe(1)
    expect(resolvePerson(PEOPLE, 'gaurav').person.id).toBe(3)
    expect(resolvePerson(PEOPLE, 'Dev').person.id).toBe(1)
  })

  it('never guesses between two people', () => {
    const r = resolvePerson(PEOPLE, 'Aum')
    expect(r.error).toBe('ambiguous')
    expect(r.candidates.map((p) => p.id).sort()).toEqual([2, 6])
  })

  it('cannot open a session as an archived person or the localtest account', () => {
    expect(resolvePerson(PEOPLE, 'Pravar').error).toBe('not_found')
    expect(resolvePerson(PEOPLE, 'dev+localtest@pocket-fund.com').error).toBe('not_found')
  })

  it('refuses an empty answer', () => {
    expect(resolvePerson(PEOPLE, '  ').error).toBe('empty')
  })
})

// In-memory crm_mcp_sessions, enough to run the real gate end to end.
function sessionDb() {
  const sessions = new Map()
  let n = 0
  const idOf = (op) => op.filters.find((f) => f[0] === 'eq' && f[1] === 'id')?.[2]
  const db = fakeSupabase((op) => {
    if (op.table === 'people') return { data: PEOPLE }
    if (op.table === 'crm_mcp_sessions') {
      if (op.type === 'insert') {
        const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
        sessions.set(id, { id, ended_at: null, ended_reason: null, tool_calls: 0, last_seen_at: new Date().toISOString(), ...op.payload })
        return { data: { id } }
      }
      const row = sessions.get(idOf(op))
      if (op.type === 'update') {
        if (row && !(op.filters.some((f) => f[0] === 'is') && row.ended_at)) Object.assign(row, op.payload)
        return { data: null }
      }
      if (!row) return { data: null }
      return { data: { ...row, people: PEOPLE.find((p) => p.id === row.person_id) } }
    }
    if (op.table === 'crm_leads' && op.type === 'insert') return { data: { id: 99, ...op.payload } }
    if (op.table === 'crm_partners' && op.type === 'insert') return { data: { id: 1, ...op.payload } }
    if (op.table === 'crm_lead_activities' && op.type === 'insert') return { data: { id: 1, ...op.payload } }
    // moveLead's own update is .single(); logActivity's last_activity stamp
    // is .select('id') and expects an array.
    if (op.table === 'crm_leads' && op.type === 'update') return { data: op.single ? { id: 5, ...op.payload } : [{ id: 5 }] }
    if (op.table === 'crm_leads' && op.single) return { data: { id: 5, stage: 'outreach' } }
    return { data: [] }
  })
  db.sessions = sessions
  return db
}

beforeEach(() => { h.db = sessionDb() })

async function withClient(account, run) {
  const server = http.createServer((req, res) => {
    res.status = (code) => { res.statusCode = code; return res }
    res.json = (body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); return res }
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', async () => {
      req.body = raw ? JSON.parse(raw) : undefined
      await handleMcp(req, res, { account })
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

const start = async (client, person) => {
  const r = await client.callTool({ name: 'start_session', arguments: { person } })
  return { r, id: r.isError ? null : JSON.parse(r.content[0].text).session_id }
}

describe('MCP session gate', () => {
  it('tells the model, up front, to ask who is using it', async () => {
    await withClient('dev@pocket-fund.com', async (client) => {
      expect(client.getInstructions()).toMatch(/Who is using the CRM right now\?/)
      const { tools } = await client.listTools()
      for (const t of tools.filter((t) => t.name !== 'start_session')) {
        expect(t.inputSchema.required, t.name).toContain('session_id')
      }
    })
  })

  it('refuses every CRM tool with no session, and says to ask', async () => {
    await withClient('dev@pocket-fund.com', async (client) => {
      const r = await client.callTool({ name: 'list_leads', arguments: { session_id: 'none' } })
      expect(r.isError).toBe(true)
      expect(r.content[0].text).toMatch(/Who is using the CRM right now\?/)
      expect(h.db.opsFor('crm_leads')).toHaveLength(0)
    })
  })

  it('opens a session for the named person and lets tools through', async () => {
    await withClient('dev@pocket-fund.com', async (client) => {
      const { id } = await start(client, 'Gaurav')
      expect(h.db.sessions.get(id)).toMatchObject({ person_id: 3, account_email: 'dev@pocket-fund.com' })
      const r = await client.callTool({ name: 'list_leads', arguments: { session_id: id } })
      expect(r.isError).toBe(false)
      expect(h.db.sessions.get(id).tool_calls).toBe(1)
    })
  })

  it('asks again on an ambiguous name instead of picking one', async () => {
    await withClient('dev@pocket-fund.com', async (client) => {
      const { r } = await start(client, 'Aum')
      expect(r.isError).toBe(true)
      expect(r.content[0].text).toMatch(/Aum Patel[\s\S]*Aum Shah/)
      expect(h.db.sessions.size).toBe(0)
    })
  })

  it(`ends a session idle for more than ${MCP_SESSION_IDLE_MINUTES} minutes and makes the next call ask again`, async () => {
    await withClient('dev@pocket-fund.com', async (client) => {
      const { id } = await start(client, 'Gaurav')
      h.db.sessions.get(id).last_seen_at = new Date(Date.now() - (MCP_SESSION_IDLE_MINUTES + 1) * 60_000).toISOString()
      const r = await client.callTool({ name: 'list_leads', arguments: { session_id: id } })
      expect(r.isError).toBe(true)
      expect(r.content[0].text).toMatch(/ended after/)
      expect(h.db.sessions.get(id)).toMatchObject({ ended_reason: 'idle' })
      // And it stays ended — touching it again does not revive it.
      const again = await client.callTool({ name: 'list_leads', arguments: { session_id: id } })
      expect(again.content[0].text).toMatch(/has ended/)
    })
  })

  it('end_session ends it; the next call must ask again', async () => {
    await withClient('dev@pocket-fund.com', async (client) => {
      const { id } = await start(client, 'Gaurav')
      await client.callTool({ name: 'end_session', arguments: { session_id: id } })
      expect(h.db.sessions.get(id).ended_reason).toBe('user_ended')
      const r = await client.callTool({ name: 'list_leads', arguments: { session_id: id } })
      expect(r.isError).toBe(true)
    })
  })

  it('a session opened under one account is unknown to another', async () => {
    let id
    await withClient('dev@pocket-fund.com', async (client) => { ({ id } = await start(client, 'Gaurav')) })
    await withClient('aum@pocket-fund.com', async (client) => {
      const r = await client.callTool({ name: 'list_leads', arguments: { session_id: id } })
      expect(r.isError).toBe(true)
      expect(r.content[0].text).toMatch(/No active session/)
    })
  })

  it('attributes writes to the session\'s person, not the account', async () => {
    await withClient('dev@pocket-fund.com', async (client) => {
      const { id } = await start(client, 'Gaurav')

      await client.callTool({ name: 'create_lead', arguments: { session_id: id, fields: { name: 'New Lead' } } })
      expect(h.db.opsFor('crm_leads', 'insert')[0].payload).toMatchObject({ created_by: 3, assigned_to: 3 })

      await client.callTool({ name: 'log_activity', arguments: { session_id: id, lead_id: 5, activity_type: 'note' } })
      expect(h.db.opsFor('crm_lead_activities', 'insert')[0].payload[0]).toMatchObject({ logged_by: 3 })

      await client.callTool({ name: 'create_partner', arguments: { session_id: id, fields: { name: 'P', created_by: 1 } } })
      // Forced to the session's person even if the model passes someone else.
      expect(h.db.opsFor('crm_partners', 'insert')[0].payload).toMatchObject({ created_by: 3 })

      await client.callTool({ name: 'update_lead', arguments: { session_id: id, id: 5, fields: { stage: 'responded' } } })
      const ev = h.db.opsFor('crm_lead_stage_events', 'insert')[0]
      expect(ev.payload).toMatchObject({ changed_by: 3 })
    })
  })
})
