import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { handleGet as getLeads, handlePost as createLead, handlePatch as updateLead } from './leads.js'
import { handleGet as getActivities, handlePost as logActivity } from './activities.js'
import { handleGet as getInvestors, handlePost as createInvestor } from './investors.js'
import { default as getAnalytics } from './analytics.js'
import { handleTags } from './_tags.js'

// Underscore-prefixed (like _auth.js/_tags.js) so Vercel does NOT count this
// as its own Serverless Function — the Hobby plan's 12-function cap bit this
// repo once already over api/tags.js. Dispatched from api/leads.js at
// ?resource=mcp, with a clean /api/mcp external path via a vercel.json
// rewrite. See api/leads.js's handler for the same reasoning as ?resource=tags.
//
// Every tool below is a thin wrapper that calls the REAL REST handler
// in-process (callHandler), not a reimplementation of its validation or
// queries. That matters: this project already shipped the same class of bug
// twice (a frozen enum list drifting from the real one — see migration 049's
// lead_type fix) by keeping a second copy of logic that was supposed to agree
// with a first. An MCP tool here can never drift from what POST /api/leads
// actually accepts, because it IS that code running, just invoked without a
// real socket.

function mockRes() {
  const res = { statusCode: 200, body: undefined }
  res.setHeader = () => res
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  res.end = () => res
  return res
}

// Calls an existing api/*.js handler in-process. CRM_API_KEY is injected into
// the synthetic request because every handler re-checks `x-api-key` on its
// own req, expecting a real HTTP call — this call is already inside a request
// api/leads.js authenticated for real before ever dispatching to
// ?resource=mcp, so handing the server's own key through here satisfies that
// check with the secret it expects; it is not a second, weaker auth path.
async function callHandler(fn, { method = 'GET', query = {}, body } = {}) {
  const req = { method, query, body, headers: { 'x-api-key': process.env.CRM_API_KEY } }
  const res = mockRes()
  await fn(req, res)
  return { status: res.statusCode, body: res.body }
}

function toolResult({ status, body }) {
  return {
    isError: status >= 400,
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
  }
}

const ACTIVITY_TYPES = ['call', 'email', 'linkedin_message', 'meeting', 'sample_sent', 'proposal_sent', 'note']

function buildServer() {
  const server = new McpServer({ name: 'pocket-fund-crm', version: '1.0.0' })

  server.registerTool('list_leads', {
    description: 'List or search leads in the CRM pipeline, or fetch one by id. Archived leads are excluded unless include_archived is true.',
    inputSchema: {
      id: z.string().optional().describe('Fetch a single lead by this id'),
      stage: z.string().optional().describe('e.g. outreach, responded, meeting_booked, warm_active, client, reach_out_later, passed'),
      lead_type: z.string().optional().describe('Admin-managed list — an invalid value comes back as a 400 naming the current options'),
      limit: z.number().int().positive().max(1000).optional(),
      include_archived: z.boolean().optional(),
    },
  }, async (args) => {
    const query = {}
    if (args.id) query.id = args.id
    if (args.stage) query.stage = args.stage
    if (args.lead_type) query.lead_type = args.lead_type
    if (args.limit) query.limit = String(args.limit)
    if (args.include_archived) query.include_archived = 'true'
    return toolResult(await callHandler(getLeads, { method: 'GET', query }))
  })

  server.registerTool('create_lead', {
    description: 'Create a new lead. name is required; assigned_to or created_by (a person id) is required — a lead with no owner is invisible to everyone but an admin. Unknown fields are ignored; invalid stage/lead_type/lead_source come back as a 400 naming the valid options. See api/README.md for the full field reference.',
    inputSchema: {
      fields: z.record(z.string(), z.unknown()).describe('Lead fields as a flat object, e.g. {"name": "...", "firm_name": "...", "assigned_to": 3, "stage": "outreach"}'),
    },
  }, async (args) => toolResult(await callHandler(createLead, { method: 'POST', body: args.fields })))

  server.registerTool('update_lead', {
    description: 'Update an existing lead by id (assigned_to, stage, next_follow_up_date, follow_up_note, notes, is_archived, lead_type, lead_channel, buying_timeline, investment_thesis, prior_acquisitions, engagement_model — see api/README.md). Stage moves are recorded to the audit trail automatically.',
    inputSchema: {
      id: z.union([z.string(), z.number()]).describe('Lead id'),
      fields: z.record(z.string(), z.unknown()).describe('Fields to update, e.g. {"stage": "responded"}'),
    },
  }, async (args) => toolResult(await callHandler(updateLead, { method: 'PATCH', query: { id: String(args.id) }, body: args.fields })))

  server.registerTool('list_activities', {
    description: 'List logged activities (calls, emails, meetings, notes) against leads.',
    inputSchema: {
      lead_id: z.union([z.string(), z.number()]).optional(),
      activity_type: z.enum(ACTIVITY_TYPES).optional(),
      limit: z.number().int().positive().max(1000).optional(),
    },
  }, async (args) => {
    const query = {}
    if (args.lead_id !== undefined) query.lead_id = String(args.lead_id)
    if (args.activity_type) query.activity_type = args.activity_type
    if (args.limit) query.limit = String(args.limit)
    return toolResult(await callHandler(getActivities, { method: 'GET', query }))
  })

  server.registerTool('log_activity', {
    description: 'Log an activity against a lead. lead_id and activity_type are required.',
    inputSchema: {
      lead_id: z.union([z.string(), z.number()]),
      activity_type: z.enum(ACTIVITY_TYPES),
      notes: z.string().optional(),
      activity_date: z.string().optional().describe('ISO timestamp; defaults to now'),
      logged_by: z.union([z.string(), z.number()]).optional().describe('Person id of whoever did the activity'),
    },
  }, async (args) => toolResult(await callHandler(logActivity, { method: 'POST', body: args })))

  server.registerTool('list_investors', {
    description: 'List or search investors, or fetch one by id.',
    inputSchema: {
      id: z.string().optional(),
      status: z.string().optional().describe('prospect, contacted, in_conversation, committed, invested, passed'),
      investor_type: z.string().optional(),
      search: z.string().optional().describe('Matches name, firm or email'),
      limit: z.number().int().positive().max(1000).optional(),
    },
  }, async (args) => {
    const query = {}
    if (args.id) query.id = args.id
    if (args.status) query.status = args.status
    if (args.investor_type) query.investor_type = args.investor_type
    if (args.search) query.search = args.search
    if (args.limit) query.limit = String(args.limit)
    return toolResult(await callHandler(getInvestors, { method: 'GET', query }))
  })

  server.registerTool('create_investor', {
    description: 'Create a new investor. name is required. See api/README.md for the full field reference.',
    inputSchema: {
      fields: z.record(z.string(), z.unknown()),
    },
  }, async (args) => toolResult(await callHandler(createInvestor, { method: 'POST', body: args.fields })))

  server.registerTool('get_analytics', {
    description: 'Pipeline analytics: stage counts, stage-to-stage conversion rates, and conversion by lead source. Excludes archived leads.',
    inputSchema: {},
  }, async () => toolResult(await callHandler(getAnalytics, { method: 'GET' })))

  server.registerTool('list_tags', {
    description: 'List every tag (optionally with usage counts), or the tags on one lead.',
    inputSchema: {
      lead_id: z.union([z.string(), z.number()]).optional(),
      with_usage: z.boolean().optional(),
    },
  }, async (args) => {
    const query = {}
    if (args.lead_id !== undefined) query.lead_id = String(args.lead_id)
    if (args.with_usage) query.with_usage = 'true'
    return toolResult(await callHandler(handleTags, { method: 'GET', query }))
  })

  server.registerTool('create_tag', {
    description: 'Create a tag, or return the existing one if the name already matches case-insensitively.',
    inputSchema: {
      name: z.string(),
      color: z.string().optional().describe('Hex color; auto-assigned from the palette if omitted'),
    },
  }, async (args) => toolResult(await callHandler(handleTags, { method: 'POST', body: { name: args.name, color: args.color } })))

  server.registerTool('assign_tag_to_leads', {
    description: 'Apply an existing tag to one or more leads. Idempotent — re-applying to an already-tagged lead is a no-op.',
    inputSchema: {
      tag_id: z.union([z.string(), z.number()]),
      lead_ids: z.array(z.union([z.string(), z.number()])),
    },
  }, async (args) => toolResult(await callHandler(handleTags, {
    method: 'POST', query: { action: 'assign' }, body: { tag_id: args.tag_id, lead_ids: args.lead_ids },
  })))

  server.registerTool('rename_tag', {
    description: 'Rename a tag in place — every lead carrying it keeps it, under the new name. Tags cannot be deleted by design, only renamed.',
    inputSchema: {
      id: z.union([z.string(), z.number()]),
      name: z.string(),
    },
  }, async (args) => toolResult(await callHandler(handleTags, { method: 'PATCH', query: { id: String(args.id) }, body: { name: args.name } })))

  return server
}

export async function handleMcp(req, res) {
  if (req.method !== 'POST') {
    // Streamable HTTP also defines GET (server-initiated SSE) and DELETE
    // (session termination) — both meaningless in stateless mode, where
    // there is no session and no long-lived stream to open.
    res.status(405)
    return res.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. Use POST.' }, id: null })
  }

  try {
    // Fresh server + transport per request — no session state to keep alive
    // between invocations of a serverless function, so stateless mode
    // (sessionIdGenerator: undefined) is the only mode that fits.
    const server = buildServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await server.connect(transport)
    res.on('close', () => { transport.close(); server.close() })
    await transport.handleRequest(req, res, req.body)
  } catch (error) {
    console.error('[mcp]', error)
    if (!res.headersSent) {
      res.status(500)
      res.json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
    }
  }
}
