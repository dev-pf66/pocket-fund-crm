import { createClient } from '@supabase/supabase-js'
import { requireEnv } from './_env.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Valid enum values
const VALID_STAGES = ['outreach', 'responded', 'meeting_booked', 'warm_active', 'client', 'reach_out_later', 'passed']
const VALID_LEAD_TYPES = ['Independent Sponsor', 'PE Firm', 'Family Office', 'Other']
const VALID_LEAD_SOURCES = ['LinkedIn', 'Referral', 'Cold Email', 'Event', 'Website']

// Fields allowed when creating a lead
const ALLOWED_FIELDS = [
  'name', 'email', 'phone', 'firm_name', 'linkedin_url',
  'lead_type', 'deal_criteria', 'lead_source', 'stage', 'notes',
  'initial_conversation', 'needs_sample_deals', 'next_follow_up_date', 'follow_up_note',
  'reach_out_later_date', 'aum', 'investment_thesis', 'portfolio_size',
  'fund_vintage'
]

function authenticate(req) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key
  const validKey = process.env.CRM_API_KEY
  // Boolean(validKey) first: without it, an unset CRM_API_KEY makes
  // `undefined === undefined` true and every unauthenticated request
  // authenticates against the service-role client. Mirrors api/_auth.js.
  return Boolean(validKey) && apiKey === validKey
}

// Fields allowed when updating a lead via PATCH
const PATCH_FIELDS = ['assigned_to', 'stage', 'next_follow_up_date', 'follow_up_note', 'notes']

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
  try {
    const { id, stage, lead_type, limit = 100 } = req.query

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

    // List leads with filters
    let query = supabase
      .from('crm_leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit))

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

    if (body.lead_type && !VALID_LEAD_TYPES.includes(body.lead_type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid lead_type. Must be one of: ${VALID_LEAD_TYPES.join(', ')}`
      })
    }

    if (body.lead_source && !VALID_LEAD_SOURCES.includes(body.lead_source)) {
      return res.status(400).json({
        success: false,
        error: `Invalid lead_source. Must be one of: ${VALID_LEAD_SOURCES.join(', ')}`
      })
    }

    // Whitelist fields
    const insert = {}
    for (const field of ALLOWED_FIELDS) {
      if (body[field] !== undefined) {
        insert[field] = body[field]
      }
    }

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
