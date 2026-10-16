import { z } from 'zod'
import * as app from './_app.js'
import { VALID_INVESTOR_TYPES, VALID_STATUSES as INVESTOR_STATUSES, ALLOWED_FIELDS as INVESTOR_FIELDS } from './investors.js'
import { CALL_OUTCOME_VALUES } from '../src/lib/callOutcomes.js'
import { OUTREACH_STATUSES } from '../src/lib/outreachStatus.js'
import { SELLER_STAGES, ITALY_STAGES, ITALY_CONTACT_TYPES, DEMO_STAGES } from '../src/lib/pipelines.js'

// The rest of the CRM as MCP tools (Oct 2026, Dev: "anything else the MCP
// doesn't have full access to — give it"). Before this the connector could
// reach leads, activities, investors (read/create), tags and partners only:
// no outreach or calls, no sellers / Italy / demos, no team list, no lead
// history, no 30-day disposition, no "what's on my plate".
//
// Every tool here calls the APP's own function (api/_app.js), so outreach
// replies still advance the lead, a call outcome still derives its status,
// and a dead lead still needs a reason. Nothing is re-implemented.
//
// Deliberately NOT exposed:
//  - Deletes of any kind (Dev's standing rule). Pipelines move things to
//    `passed`; a lead can be archived via update_lead { is_archived: true }.
//  - Admin: people/accounts, targets, field-option and settings edits,
//    archive sweeps. Account admin is Dev's.
//  - AI analysis (transcripts, LinkedIn enrichment, outreach analysis). Each
//    call spends ANTHROPIC_API_KEY credits; that stays a deliberate click.
//  - Sage task creation (no agent writes to Sage).

const keys = (list) => list.map((x) => x.key)
const OUTREACH_STATUS_VALUES = OUTREACH_STATUSES.map((s) => s.value)

const ID = z.union([z.string(), z.number()])
const FIELDS = z.record(z.string(), z.unknown())
const LIMIT = z.number().int().positive().max(1000).optional()
  .describe('Max rows returned (default 100). `total` says how many matched.')

const json = (v) => ({ isError: false, content: [{ type: 'text', text: JSON.stringify(v, null, 2) }] })
const fail = (message) => ({ isError: true, content: [{ type: 'text', text: message }] })

function page(rows, limit = 100) {
  return { total: rows.length, count: Math.min(rows.length, limit), truncated: rows.length > limit, data: rows.slice(0, limit) }
}

function matches(row, q, cols) {
  const needle = String(q || '').trim().toLowerCase()
  return !needle || cols.some((c) => String(row[c] ?? '').toLowerCase().includes(needle))
}

function badValue(value, allowed, label) {
  if (value === undefined || value === null) return null
  return allowed.includes(value) ? null : `Invalid ${label} "${value}". Must be one of: ${allowed.join(', ')}`
}

// provider_payload is CallHippo's raw record — kept forever in the DB, but
// pages of noise in a chat.
const lean = (row) => {
  if (!row || typeof row !== 'object') return row
  const { provider_payload: _p, ...rest } = row
  return rest
}

// Fields that are history or derived, never set by hand through a tool.
function strip(fields, extra = []) {
  const out = { ...(fields || {}) }
  for (const k of ['id', 'created_at', 'updated_at', 'created_by', ...extra]) delete out[k]
  return out
}

// Outreach/calls need a lead_name (the activity text and the reply → lead
// promotion read it). Fill it from the lead when only lead_id was given.
async function withLeadName(fields) {
  if (fields.lead_id && !fields.lead_name) {
    const lead = await app.getLeadById(fields.lead_id)
    return { ...fields, lead_name: lead.name, firm_name: fields.firm_name ?? lead.firm_name }
  }
  return fields
}

export function registerAppTools(tool) {
  // ---------------------------------------------------------------- reference

  tool('list_people', {
    description: 'The team: person ids, names, emails, admin/archived flags. Use it to turn a name into the id that assigned_to / logged_by / created_by expect.',
    inputSchema: { include_archived: z.boolean().optional() },
  }, async ({ include_archived }) => {
    const people = (await app.getPeople())
      .filter((p) => !/\+localtest/.test(p.email || ''))
      .filter((p) => include_archived || !p.is_archived)
      .map(({ id, name, email, is_admin, is_archived }) => ({ id, name, email, is_admin, is_archived }))
    return json(people)
  })

  tool('list_field_options', {
    description: 'Valid values for an admin-managed dropdown: lead_type, lead_channel, lead_source, dead_reason, industry, location, deal_size, buying_timeline, engagement_model.',
    inputSchema: { field: z.string() },
  }, async ({ field }) => {
    if (field === 'lead_type') return json((await app.getLeadTypeOptions()).map((o) => o.name))
    return json((await app.getFieldOptions(field)).map((o) => o.value))
  })

  // -------------------------------------------------------------------- leads

  tool('get_lead_detail', {
    description: 'Everything about one lead in one call: the lead, its activities, outreach, calls, call transcripts (with AI summaries where they exist), tags, PE OS demos and stage history.',
    inputSchema: {
      id: ID,
      transcript_chars: z.number().int().min(0).max(20000).optional().describe('Characters of each transcript to include (default 1500; summaries are always included)'),
    },
  }, async ({ id, transcript_chars = 1500 }) => {
    const parts = {
      lead: app.getLeadById(id),
      activities: app.getLeadActivities(id),
      outreach: app.getOutreachForLead(id),
      calls: app.getCallsForLead(id),
      transcripts: app.getLeadTranscripts(id),
      tags: app.getLeadTags(id),
      demos: app.getDemosForLead(id),
      stage_history: app.getStageEvents(id),
    }
    const names = Object.keys(parts)
    const settled = await Promise.allSettled(Object.values(parts))
    const out = { errors: [] }
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') out[names[i]] = r.value
      else out.errors.push({ part: names[i], message: r.reason?.message || String(r.reason) })
    })
    if (!out.lead) return fail(`Lead ${id} not found${out.errors[0] ? `: ${out.errors[0].message}` : ''}`)
    out.outreach = (out.outreach || []).map(lean)
    out.calls = (out.calls || []).map(lean)
    out.transcripts = (out.transcripts || []).map((t) => ({
      ...t,
      transcript: t.transcript && t.transcript.length > transcript_chars
        ? `${t.transcript.slice(0, transcript_chars)}… [${t.transcript.length - transcript_chars} more chars]`
        : t.transcript,
      analysed: Boolean(t.ai_analysis),
    }))
    return json(out)
  })

  tool('dispose_lead', {
    description: 'Answer a lead\'s 30-day clock. dead → passed, needs a reason from list_field_options(dead_reason). later → reach_out_later, needs follow_up_date. investor / partner → passed with that reason. working → nothing wrong, resets the clock. Never archives or deletes.',
    inputSchema: {
      id: ID,
      disposition: z.enum(app.DISPOSITIONS),
      reason: z.string().optional(),
      note: z.string().optional(),
      follow_up_date: z.string().optional().describe('YYYY-MM-DD'),
    },
  }, async ({ id, disposition, reason, note, follow_up_date }, person) => {
    if (disposition === 'dead') {
      const options = (await app.getFieldOptions('dead_reason')).map((o) => o.value)
      if (!options.includes(reason)) {
        return fail(`A dead lead needs a reason from the list: ${options.join(', ')}. (An admin can add more in Admin → field options.)`)
      }
    }
    const lead = await app.disposeLead(id, { disposition, reason, note, followUpDate: follow_up_date }, person.id)
    return json(lead)
  })

  tool('set_do_not_call', {
    description: 'Flag (or unflag) a lead as do-not-call. A flagged lead never appears in the call queue.',
    inputSchema: { lead_id: ID, value: z.boolean().optional().describe('Default true') },
  }, async ({ lead_id, value = true }) => json(await app.setDoNotCall(lead_id, value)))

  // ----------------------------------------------------------------- outreach

  tool('list_outreach', {
    description: 'Outreach log (LinkedIn messages, emails, calls…), newest first. Pass lead_id for one lead\'s full history; otherwise a window of days_back (default 30).',
    inputSchema: {
      lead_id: ID.optional(),
      days_back: z.number().int().positive().max(365).optional(),
      outreach_type: z.string().optional().describe('e.g. linkedin_message, cold_email, phone_call'),
      status: z.enum(OUTREACH_STATUS_VALUES).optional(),
      logged_by: ID.optional().describe('Person id'),
      limit: LIMIT,
    },
  }, async ({ lead_id, days_back = 30, outreach_type, status, logged_by, limit }) => {
    const rows = lead_id
      ? await app.getOutreachForLead(lead_id)
      : await app.getOutreachLog({ days_back, outreach_type, status }, logged_by ?? null)
    return json(page(rows.map(lean), limit))
  })

  tool('log_outreach', {
    description: 'Log an outreach touch (NOT a phone call — use log_call). Needs outreach_type and lead_id or lead_name. Logged as replied/rejected, it advances the lead to responded (forward-only) or creates the lead — the same reply → pipeline sync the app runs. logged_by is the session\'s person.',
    inputSchema: {
      fields: FIELDS.describe(`e.g. {"lead_id": 12, "outreach_type": "linkedin_message", "status": "sent", "message_content": "...", "outreach_date": "2026-10-16"}. status: ${OUTREACH_STATUS_VALUES.join(', ')}`),
    },
  }, async ({ fields }, person) => {
    const f = strip(fields, ['logged_by', 'replied_at', 'call_outcome', 'claimed_at', 'provider_call_id', 'provider_payload'])
    if (!f.outreach_type) return fail('outreach_type is required')
    if (f.outreach_type === 'phone_call') return fail('Phone calls go through log_call, which derives the status from the outcome.')
    if (!f.lead_id && !f.lead_name) return fail('lead_id or lead_name is required')
    const bad = badValue(f.status, OUTREACH_STATUS_VALUES, 'status')
    if (bad) return fail(bad)
    return json(lean(await app.logOutreach(await withLeadName(f), person.id, person.name)))
  })

  tool('update_outreach', {
    description: 'Update an outreach entry — most often status (marking replied runs the reply → pipeline sync). For a phone call use update_call.',
    inputSchema: { id: ID, fields: FIELDS.describe(`e.g. {"status": "replied"}. status: ${OUTREACH_STATUS_VALUES.join(', ')}`) },
  }, async ({ id, fields }, person) => {
    const row = await app.getOutreachRow(id)
    if (!row) return fail(`Outreach entry ${id} not found`)
    if (row.outreach_type === 'phone_call') return fail('That entry is a phone call — use update_call, so its status stays derived from the outcome.')
    const f = strip(fields, ['logged_by', 'claimed_at', 'provider_call_id', 'provider_payload', 'call_outcome'])
    const bad = badValue(f.status, OUTREACH_STATUS_VALUES, 'status')
    if (bad) return fail(bad)
    if (!Object.keys(f).length) return fail('No fields to update')
    return json(lean(await app.updateOutreach(id, f, person.id)))
  })

  // -------------------------------------------------------------------- calls

  tool('list_calls', {
    description: 'Cold calls (one row per dial), newest first, over days_back (default 30).',
    inputSchema: {
      days_back: z.number().int().positive().max(365).optional(),
      outcome: z.enum(CALL_OUTCOME_VALUES).optional(),
      lead_id: ID.optional(),
      logged_by: ID.optional().describe('Person id'),
      limit: LIMIT,
    },
  }, async ({ days_back = 30, outcome, lead_id, logged_by, limit }) => {
    const rows = await app.getCallLog({ daysBack: days_back, outcome: outcome ?? null, leadId: lead_id ?? null }, logged_by ?? null)
    return json(page(rows.map(lean), limit))
  })

  tool('log_call', {
    description: 'Log one dial. status, connected and attempt number are derived from call_outcome; a conversation advances the lead to responded, meeting_booked to meeting_booked, do_not_call flags the lead, callback_at sets the follow-up. logged_by is the session\'s person.',
    inputSchema: {
      fields: FIELDS.describe(`e.g. {"lead_id": 12, "call_outcome": "interested", "call_duration_seconds": 240, "notes": "...", "callback_at": "2026-10-20T15:00:00+05:30"}. call_outcome: ${CALL_OUTCOME_VALUES.join(', ')}`),
    },
  }, async ({ fields }, person) => {
    const f = strip(fields, ['logged_by', 'status', 'claimed_at', 'provider_payload'])
    const bad = badValue(f.call_outcome, CALL_OUTCOME_VALUES, 'call_outcome')
    if (bad) return fail(bad)
    if (!f.lead_id && !f.lead_name && !f.phone_number) return fail('lead_id, lead_name or phone_number is required')
    return json(lean(await app.logCall(await withLeadName(f), person.id, person.name)))
  })

  tool('update_call', {
    description: 'Fix or classify a logged call — outcome, notes, recording_url, callback_at. Changing the outcome re-derives status and re-runs its pipeline effects (forward-only).',
    inputSchema: { id: ID, fields: FIELDS.describe(`call_outcome: ${CALL_OUTCOME_VALUES.join(', ')}`) },
  }, async ({ id, fields }, person) => {
    const row = await app.getOutreachRow(id)
    if (!row) return fail(`Call ${id} not found`)
    if (row.outreach_type !== 'phone_call') return fail('That entry is not a phone call — use update_outreach.')
    const f = strip(fields, ['logged_by', 'status', 'claimed_at', 'provider_call_id', 'provider_payload', 'outreach_type'])
    const bad = badValue(f.call_outcome, CALL_OUTCOME_VALUES, 'call_outcome')
    if (bad) return fail(bad)
    if (!Object.keys(f).length) return fail('No fields to update')
    return json(lean(await app.updateCall(id, f, person.id)))
  })

  tool('list_unclaimed_calls', {
    description: 'Dials imported from CallHippo that nobody has claimed yet (they log under one shared seat, so the import cannot tell who dialled).',
    inputSchema: { days_back: z.number().int().positive().max(60).optional(), limit: LIMIT },
  }, async ({ days_back = 30, limit }) => json(page((await app.getUnclaimedCalls({ daysBack: days_back })).map(lean), limit)))

  tool('claim_call', {
    description: 'Claim an imported call as the session person\'s own dial — only ever for the person using the CRM right now, never on someone\'s behalf. Optionally classify it in the same step.',
    inputSchema: { id: ID, outcome: z.enum(CALL_OUTCOME_VALUES).optional(), notes: z.string().optional() },
  }, async ({ id, outcome, notes }, person) => json(lean(await app.claimCall(id, person.id, { outcome: outcome ?? null, notes: notes ?? null }))))

  tool('add_call_transcript', {
    description: 'Attach a call/meeting transcript to a lead. Stored as-is — AI analysis is NOT run (it costs credits; it stays a button in the app).',
    inputSchema: {
      lead_id: ID,
      transcript: z.string(),
      title: z.string().optional(),
      outreach_log_id: ID.optional().describe('The call row this transcript belongs to, if any'),
      call_date: z.string().optional().describe('ISO timestamp; defaults to now'),
    },
  }, async ({ lead_id, transcript, title, outreach_log_id, call_date }, person) => {
    const row = await app.logCallTranscript({
      leadId: lead_id, outreachLogId: outreach_log_id ?? null, transcript, title: title ?? null,
      calledAt: call_date ?? null, currentPersonId: person.id,
    })
    return row ? json(row) : fail('transcript is empty')
  })

  // ---------------------------------------------------------------- pipelines

  const pipeline = ({ noun, plural, list, create, update, stages, searchCols, extraFilters = {}, validate = () => null, required = ['name'] }) => {
    tool(`list_${plural}`, {
      description: `List ${noun} records. Stages: ${stages.join(', ')}.`,
      inputSchema: { stage: z.enum(stages).optional(), search: z.string().optional(), ...extraFilters, limit: LIMIT },
    }, async ({ stage, search, limit, ...rest }) => {
      let rows = await list()
      if (stage) rows = rows.filter((r) => r.stage === stage)
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) rows = rows.filter((r) => String(r[k]) === String(v))
      rows = rows.filter((r) => matches(r, search, searchCols))
      return json(page(rows, limit))
    })

    tool(`create_${noun.replace(/ /g, '_')}`, {
      description: `Create a ${noun}. Required: ${required.join(', ')}. created_by is the session's person. Stages: ${stages.join(', ')}.`,
      inputSchema: { fields: FIELDS },
    }, async ({ fields }, person) => {
      const f = strip(fields)
      for (const r of required) if (!String(f[r] ?? '').trim()) return fail(`${r} is required`)
      const bad = badValue(f.stage, stages, 'stage') || validate(f)
      if (bad) return fail(bad)
      return json(await create(f, person.id))
    })

    tool(`update_${noun.replace(/ /g, '_')}`, {
      description: `Update a ${noun} by id. Stages: ${stages.join(', ')}. No delete — move it to passed.`,
      inputSchema: { id: ID, fields: FIELDS },
    }, async ({ id, fields }) => {
      const f = strip(fields)
      const bad = badValue(f.stage, stages, 'stage') || validate(f)
      if (bad) return fail(bad)
      if (!Object.keys(f).length) return fail('No fields to update')
      return json(await update(id, f))
    })
  }

  pipeline({
    noun: 'seller', plural: 'sellers', stages: keys(SELLER_STAGES),
    list: app.getSellers, create: app.createSeller, update: app.updateSeller,
    searchCols: ['name', 'business_name', 'industry', 'location', 'email', 'notes'],
    extraFilters: { assigned_to: ID.optional() },
  })

  pipeline({
    noun: 'italy contact', plural: 'italy_contacts', stages: keys(ITALY_STAGES),
    list: app.getItalyPipeline, create: app.createItalyContact, update: app.updateItalyContact,
    searchCols: ['name', 'company_name', 'industry', 'location', 'email', 'notes'],
    extraFilters: { contact_type: z.enum(keys(ITALY_CONTACT_TYPES)).optional(), assigned_to: ID.optional() },
    validate: (f) => badValue(f.contact_type, keys(ITALY_CONTACT_TYPES), 'contact_type'),
  })

  pipeline({
    noun: 'demo', plural: 'demos', stages: keys(DEMO_STAGES),
    list: () => app.getDemos(null), create: app.createDemo, update: app.updateDemo,
    searchCols: ['contact_name', 'contact_firm', 'notes', 'use_case', 'feedback'],
    extraFilters: { lead_id: ID.optional() },
    required: ['contact_name'],
  })

  // ---------------------------------------------------------------- investors

  tool('update_investor', {
    description: `Update an investor by id. investor_type: ${VALID_INVESTOR_TYPES.join(', ')}. status: ${INVESTOR_STATUSES.join(', ')}.`,
    inputSchema: { id: ID, fields: FIELDS.describe(`Allowed: ${INVESTOR_FIELDS.join(', ')}`) },
  }, async ({ id, fields }) => {
    const f = {}
    for (const k of INVESTOR_FIELDS) if (fields?.[k] !== undefined) f[k] = fields[k]
    const bad = badValue(f.investor_type, VALID_INVESTOR_TYPES, 'investor_type') || badValue(f.status, INVESTOR_STATUSES, 'status')
    if (bad) return fail(bad)
    if (!Object.keys(f).length) return fail(`No updatable fields. Allowed: ${INVESTOR_FIELDS.join(', ')}`)
    return json(await app.updateInvestor(id, f))
  })

  tool('list_investor_interactions', {
    description: 'Calls, meetings and notes logged against one investor, newest first.',
    inputSchema: { investor_id: ID },
  }, async ({ investor_id }) => json(await app.getInvestorInteractions(investor_id)))

  tool('log_investor_interaction', {
    description: 'Log an interaction with an investor. logged_by is the session\'s person.',
    inputSchema: {
      investor_id: ID,
      fields: FIELDS.describe('e.g. {"interaction_type": "call", "interaction_date": "2026-10-16", "notes": "..."}'),
    },
  }, async ({ investor_id, fields }, person) => json(await app.logInvestorInteraction(investor_id, strip(fields, ['logged_by', 'investor_id']), person.id)))

  // -------------------------------------------------------------------- views

  tool('get_my_day', {
    description: 'What the person using the CRM should do today — their Today queue (leads to touch, ranked) and their notification feed (callbacks, demos, follow-ups due, leads gone quiet). Same derivation as the app\'s Today tab.',
    inputSchema: { limit: z.number().int().positive().max(100).optional().describe('Default 25') },
  }, async ({ limit = 25 }, person) => {
    const [queue, feed] = await Promise.allSettled([
      app.getTodayQueue(person.id, { limit }),
      app.getNotificationFeed(person.id, { isAdmin: Boolean(person.is_admin), limit }),
    ])
    return json({
      person: person.name,
      today_queue: queue.status === 'fulfilled' ? queue.value : { error: queue.reason?.message },
      notifications: feed.status === 'fulfilled' ? feed.value : { error: feed.reason?.message },
    })
  })

  tool('get_scoreboard', {
    description: 'Per-person numbers for a week (default: this week, Monday–today IST): outreach, dials, meetings booked and held, follow-ups, plus the un-windowed breach counts. Same as the app\'s Numbers tab.',
    inputSchema: {
      start: z.string().optional().describe('YYYY-MM-DD (IST), inclusive'),
      end: z.string().optional().describe('YYYY-MM-DD (IST), inclusive'),
    },
  }, async ({ start, end }) => {
    const week = app.currentWeekBounds()
    const people = (await app.getPeople()).filter((p) => !p.is_archived && !/\+localtest/.test(p.email || ''))
    return json(await app.getScoreboard({ start: start || week.start, end: end || week.end, people }))
  })
}
