import { createClient } from '@supabase/supabase-js'
import { requireEnv } from './_env.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Valid enum values
const VALID_STAGES = ['outreach', 'responded', 'meeting_booked', 'warm_active', 'client', 'reach_out_later', 'passed']
// Fallback only. lead_type is admin-managed in crm_lead_type_options (migration
// 022) and the UI reads it from there via useLeadTypes, so a hardcoded list here
// drifts the moment an admin adds a type: the app writes it happily while this
// API rejects it with a 400. Live data already contains CA, WealthMgr,
// Lawyer MA, vCFO, CS and PrivateBanker — none of which this array knew about.
const DEFAULT_LEAD_TYPES = ['Independent Sponsor', 'PE Firm', 'Family Office', 'Other']

// Reads the admin-managed options, falling back to the defaults if the table is
// absent (un-migrated project) or the read fails — mirrors the UI hook rather
// than failing a write over a config lookup.
async function getValidLeadTypes() {
  try {
    const { data, error } = await supabase.from('crm_lead_type_options').select('name')
    if (error || !data?.length) return DEFAULT_LEAD_TYPES
    return data.map(r => r.name)
  } catch {
    return DEFAULT_LEAD_TYPES
  }
}
const VALID_LEAD_SOURCES = ['LinkedIn', 'Referral', 'Cold Email', 'Event', 'Website']

// Fields allowed when creating a lead.
//
// assigned_to / created_by are on this list because THIS ENDPOINT WAS THE
// SOURCE OF THE UNOWNED LEADS. It whitelisted neither, so every lead created
// over HTTP landed with both NULL — 203 leads, and still happening: one was
// created unowned on 2026-09-27. The browser paths have defaulted ownership to
// the creator since July 2026 (createLead in src/lib/api/leads.js); the API
// silently did not, and an unowned lead is invisible to every non-admin under
// RLS (migration 018) and absent from every per-person surface.
const ALLOWED_FIELDS = [
  'name', 'email', 'phone', 'firm_name', 'linkedin_url',
  'lead_type', 'deal_criteria', 'lead_source', 'stage', 'notes',
  'initial_conversation', 'needs_sample_deals', 'next_follow_up_date', 'follow_up_note',
  'reach_out_later_date', 'aum', 'investment_thesis', 'portfolio_size',
  'fund_vintage', 'assigned_to', 'created_by'
]

function authenticate(req) {
  // Header only — a key in the query string leaks into access logs, browser
  // history and Referer headers. See api/_auth.js.
  const apiKey = req.headers['x-api-key']
  const validKey = process.env.CRM_API_KEY
  // Boolean(validKey) first: without it, an unset CRM_API_KEY makes
  // `undefined === undefined` true and every unauthenticated request
  // authenticates against the service-role client. Mirrors api/_auth.js.
  return Boolean(validKey) && apiKey === validKey
}

// Fields allowed when updating a lead via PATCH
// is_archived is patchable so the archive is operable from the API too, not
// only from the Admin UI. archived_at/archived_reason are set by the app's
// own helpers; a bare flag flip here is still fully reversible.
// The required-info fields (migration 052) are patchable so the /crm skill and
// any agent can fill them — the channel question in particular is missing on
// every lead in the database, and backfilling 115 leads through the UI one
// dropdown at a time is not a plan.
const PATCH_FIELDS = [
  'assigned_to', 'stage', 'next_follow_up_date', 'follow_up_note', 'notes', 'is_archived',
  'lead_type', 'lead_channel', 'buying_timeline', 'investment_thesis',
  'prior_acquisitions', 'engagement_model'
]

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (!requireEnv(res, ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRM_API_KEY'])) return

  if (!authenticate(req)) {
    return res.status(401).json({ error: 'Unauthorized. Provide valid x-api-key header.' })
  }

  if (req.method === 'GET') {
    return handleGet(req, res)
  } else if (req.method === 'POST') {
    return handlePost(req, res)
  } else if (req.method === 'PATCH') {
    return handlePatch(req, res)
  } else {
    return res.status(405).json({ error: 'Method not allowed. Use GET, POST, or PATCH.' })
  }
}

async function handleGet(req, res) {
  if (req.query.view === 'stage_events') return handleStageEvents(req, res)
  try {
    const { id, stage, lead_type, limit = 100, include_archived } = req.query

    // Single lead by ID
    if (id) {
      const { data, error } = await supabase
        .from('crm_leads')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ success: false, error: 'Lead not found' })
        }
        throw error
      }

      return res.status(200).json({ success: true, data })
    }

    // List leads with filters. Archived leads are out of the working book by
    // default so this agrees with the app's boards and counts; pass
    // ?include_archived=true to see them.
    let query = supabase
      .from('crm_leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit))

    if (include_archived !== 'true') {
      query = query.eq('is_archived', false)
    }

    if (stage) {
      query = query.eq('stage', stage)
    }

    if (lead_type) {
      query = query.eq('lead_type', lead_type)
    }

    const { data, error } = await query

    if (error) throw error

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}

// GET /api/leads?view=stage_events[&to_stage=][&from_stage=][&since=YYYY-MM-DD][&limit=]
//
// The stage history, read-only. crm_leads.stage is overwritten in place, so this
// log is the only answer to "who BECAME a client this month". The tracker's goals
// dashboard counted client rows by updated_at instead, which counts any edit to an
// old client as a new one. Rides this function rather than a new file: the
// dashboard reads it with the same key as /leads.
//
// Each row carries the lead's CURRENT stage and archive flag, so a caller can drop
// moves that were later undone — six leads went to client and back within days on
// 2026-08-29..09-03. Newest first.
async function handleStageEvents(req, res) {
  try {
    const { to_stage, from_stage, since, limit = 100 } = req.query
    if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
      return res.status(400).json({ success: false, error: 'since must be YYYY-MM-DD' })
    }

    let query = supabase
      .from('crm_lead_stage_events')
      .select('id, lead_id, from_stage, to_stage, changed_by, changed_at, crm_leads(name, stage, is_archived)')
      .order('changed_at', { ascending: false })
      .limit(parseInt(limit))

    if (to_stage) query = query.eq('to_stage', to_stage)
    if (from_stage) query = query.eq('from_stage', from_stage)
    if (since) query = query.gte('changed_at', since)

    const { data, error } = await query
    if (error) throw error

    const rows = (data || []).map(({ crm_leads: lead, ...event }) => ({
      ...event,
      lead_name: lead?.name ?? null,
      current_stage: lead?.stage ?? null,
      lead_is_archived: lead?.is_archived ?? null
    }))

    return res.status(200).json({ success: true, count: rows.length, data: rows })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}

async function handlePost(req, res) {
  try {
    const body = req.body

    // Validate required field
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return res.status(400).json({ success: false, error: 'name is required' })
    }

    // Validate enums
    if (body.stage && !VALID_STAGES.includes(body.stage)) {
      return res.status(400).json({
        success: false,
        error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}`
      })
    }

    if (body.lead_type) {
      const validLeadTypes = await getValidLeadTypes()
      if (!validLeadTypes.includes(body.lead_type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid lead_type. Must be one of: ${validLeadTypes.join(', ')}`
        })
      }
    }

    if (body.lead_source && !VALID_LEAD_SOURCES.includes(body.lead_source)) {
      return res.status(400).json({
        success: false,
        error: `Invalid lead_source. Must be one of: ${VALID_LEAD_SOURCES.join(', ')}`
      })
    }

    // Every lead needs an owner, and this endpoint has no logged-in user to
    // infer one from — it authenticates with a shared API key, so the caller
    // has to say who the lead belongs to. Rejecting is the only honest option:
    // defaulting to some house account would put leads in a book nobody reads,
    // and defaulting to NULL is the bug this replaces.
    const ownerId = body.assigned_to ?? body.created_by
    if (ownerId === undefined || ownerId === null || ownerId === '') {
      return res.status(400).json({
        success: false,
        error: 'assigned_to (or created_by) is required — a lead with no owner is invisible to everyone but an admin. Pass the person id of whoever this lead belongs to.'
      })
    }

    // Whitelist fields
    const insert = {}
    for (const field of ALLOWED_FIELDS) {
      if (body[field] !== undefined) {
        insert[field] = body[field]
      }
    }

    // Whichever one the caller supplied, both end up set — the boards filter on
    // `created_by OR assigned_to` but the owner LABEL reads assigned_to, so a
    // lead with only one of them shows up owned by nobody.
    insert.assigned_to = insert.assigned_to ?? ownerId
    insert.created_by = insert.created_by ?? ownerId
    insert.assigned_date = new Date().toISOString()

    const { data, error } = await supabase
      .from('crm_leads')
      .insert(insert)
      .select()
      .single()

    if (error) throw error

    return res.status(201).json({ success: true, data })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}

async function handlePatch(req, res) {
  try {
    const body = req.body || {}
    const id = req.query.id || body.id

    if (!id) {
      return res.status(400).json({ success: false, error: 'id is required (query param or body field)' })
    }

    if (body.stage && !VALID_STAGES.includes(body.stage)) {
      return res.status(400).json({
        success: false,
        error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}`
      })
    }

    // Whitelist updatable fields
    const updates = {}
    for (const field of PATCH_FIELDS) {
      if (body[field] !== undefined) {
        updates[field] = body[field]
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: `No updatable fields provided. Allowed: ${PATCH_FIELDS.join(', ')}`
      })
    }

    // Capture the prior stage before writing, so a stage change made through
    // the API lands in crm_lead_stage_events like one made in the UI. CLAUDE.md
    // designates this endpoint the preferred access path (the /crm skill and
    // agents use it), so without this the "leads moved forward" metric
    // undercounts every move made through the front door.
    let priorStage = null
    if (updates.stage !== undefined) {
      const { data: prior } = await supabase
        .from('crm_leads').select('stage').eq('id', id).single()
      priorStage = prior?.stage ?? null
    }

    const { data, error } = await supabase
      .from('crm_leads')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ success: false, error: 'Lead not found' })
      }
      throw error
    }

    // changed_by stays null: this endpoint authenticates a machine via API
    // key, not a person, so attributing the move to someone would be a lie —
    // the team strip renders those as "Unattributed". Best-effort: a missing
    // audit row must not fail the caller's update.
    if (updates.stage !== undefined && priorStage !== data.stage) {
      const { error: evErr } = await supabase.from('crm_lead_stage_events').insert({
        lead_id: Number(id),
        from_stage: priorStage,
        to_stage: data.stage,
        changed_by: null
      })
      if (evErr) console.error('stage event insert failed (lead update succeeded):', evErr)
    }

    return res.status(200).json({ success: true, data })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}
