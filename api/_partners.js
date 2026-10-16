import { createClient } from '@supabase/supabase-js'
import { fetchAllRows } from './_db.js'
import { PARTNER_STAGE_KEYS, categoryKeyFromLabel } from '../src/lib/partners.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Partners over HTTP (Oct 2026) — crm_partners had no endpoint at all, so the
// MCP connector (and any agent) could not see the partner pipeline. Dispatched
// from api/leads.js at ?resource=partners, same as tags, because the Hobby
// plan caps a deployment at 12 functions and api/ is already at 12.
// CORS/env/auth are handled by the caller before this runs.
//
// Deliberately no DELETE: the board can delete a partner, but an API/agent
// path that removes rows is a different risk. Move it to `passed` instead.

const FIELDS = [
  'name', 'categories', 'stage', 'company_name', 'industry', 'url', 'linkedin_url',
  'email', 'handle', 'audience_size', 'notes', 'next_follow_up_date', 'last_contact_date',
]

export async function handlePartners(req, res) {
  if (req.method === 'GET') return handleGet(req, res)
  if (req.method === 'POST') return handlePost(req, res)
  if (req.method === 'PATCH') return handlePatch(req, res)
  return res.status(405).json({ error: 'Method not allowed. Use GET, POST or PATCH.' })
}

// Shared shape checks for create and update. Returns an error string or null,
// and normalises categories in place (same key rule as the board, so "M&A
// Advisor" from the API and from the app land as the same m_a_advisor).
function validate(body) {
  if (body.stage !== undefined && !PARTNER_STAGE_KEYS.includes(body.stage)) {
    return `Invalid stage. Must be one of: ${PARTNER_STAGE_KEYS.join(', ')}`
  }
  if (body.categories !== undefined) {
    if (!Array.isArray(body.categories)) return 'categories must be an array of strings'
    body.categories = [...new Set(body.categories.map(categoryKeyFromLabel).filter(Boolean))]
  }
  return null
}

function pick(body) {
  const out = {}
  for (const f of FIELDS) if (body[f] !== undefined) out[f] = body[f]
  return out
}

// GET ?resource=partners                    -> every partner (paged, never truncated at 1000)
// GET ?resource=partners&id=12              -> one partner
// GET ?resource=partners&stage=reached_out  -> filter by stage
// GET ?resource=partners&category=creator   -> partners carrying that category
// GET ?resource=partners&search=acme        -> name / company / handle / email contains
async function handleGet(req, res) {
  try {
    const { id, stage, category, search } = req.query

    if (id) {
      const { data, error } = await supabase.from('crm_partners').select('*').eq('id', id).maybeSingle()
      if (error) throw error
      if (!data) return res.status(404).json({ success: false, error: 'Partner not found' })
      return res.status(200).json({ success: true, data })
    }

    if (stage && !PARTNER_STAGE_KEYS.includes(stage)) {
      return res.status(400).json({ success: false, error: `Invalid stage. Must be one of: ${PARTNER_STAGE_KEYS.join(', ')}` })
    }

    const rows = await fetchAllRows(() => {
      let q = supabase.from('crm_partners').select('*')
      if (stage) q = q.eq('stage', stage)
      if (category) q = q.contains('categories', [categoryKeyFromLabel(category)])
      return q.order('updated_at', { ascending: false }).order('id')
    })

    const needle = String(search || '').trim().toLowerCase()
    const data = needle
      ? rows.filter((p) => ['name', 'company_name', 'handle', 'email', 'industry']
        .some((f) => String(p[f] || '').toLowerCase().includes(needle)))
      : rows

    return res.status(200).json({ success: true, count: data.length, data })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}

// POST ?resource=partners  { name, categories?, stage?, ..., created_by }
async function handlePost(req, res) {
  try {
    const body = { ...(req.body || {}) }
    if (!String(body.name || '').trim()) {
      return res.status(400).json({ success: false, error: 'name is required' })
    }
    const invalid = validate(body)
    if (invalid) return res.status(400).json({ success: false, error: invalid })

    const insert = pick(body)
    insert.name = String(body.name).trim()
    if (body.created_by !== undefined) insert.created_by = body.created_by

    const { data, error } = await supabase.from('crm_partners').insert(insert).select().single()
    if (error) throw error
    return res.status(201).json({ success: true, data })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}

// PATCH ?resource=partners&id=12  { stage?, notes?, ... }  — created_by is history, not patchable.
async function handlePatch(req, res) {
  try {
    const id = req.query.id || req.body?.id
    if (!id) return res.status(400).json({ success: false, error: 'id is required' })

    const body = { ...(req.body || {}) }
    const invalid = validate(body)
    if (invalid) return res.status(400).json({ success: false, error: invalid })
    if (body.name !== undefined && !String(body.name).trim()) {
      return res.status(400).json({ success: false, error: 'name cannot be empty' })
    }

    const updates = pick(body)
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: `No updatable fields provided. Allowed: ${FIELDS.join(', ')}` })
    }

    const { data, error } = await supabase.from('crm_partners').update(updates).eq('id', id).select().maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ success: false, error: 'Partner not found' })
    return res.status(200).json({ success: true, data })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}
