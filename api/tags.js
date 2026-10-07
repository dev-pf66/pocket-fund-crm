import { createClient } from '@supabase/supabase-js'
import { requireEnv } from './_env.js'
import { fetchAllRows } from './_db.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Mirrors the palette in src/lib/api/misc.js so a tag created over HTTP looks
// like one created in the app — cycled by tag count rather than asking a
// caller to pick a hex code.
const TAG_COLORS = [
  '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
  '#84cc16', '#6366f1', '#ec4899', '#0ea5e9', '#f97316',
]

function authenticate(req) {
  // Header only — a key in the query string leaks into access logs, browser
  // history and Referer headers. See api/_auth.js.
  const apiKey = req.headers['x-api-key']
  const validKey = process.env.CRM_API_KEY
  return Boolean(validKey) && apiKey === validKey
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
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
  } else if (req.method === 'DELETE') {
    return handleDelete(req, res)
  } else {
    return res.status(405).json({ error: 'Method not allowed. Use GET, POST, PATCH or DELETE.' })
  }
}

async function getAllTags() {
  const { data, error } = await supabase
    .from('crm_tags')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return data || []
}

// GET /api/tags                 -> every tag
// GET /api/tags?with_usage=true -> every tag + how many leads carry it
// GET /api/tags?lead_id=123     -> the tags on one lead
async function handleGet(req, res) {
  try {
    const { lead_id, with_usage } = req.query

    if (lead_id) {
      const { data, error } = await supabase
        .from('crm_lead_tags')
        .select('tag:crm_tags(id, name, color)')
        .eq('lead_id', lead_id)

      if (error) throw error
      return res.status(200).json({
        success: true,
        data: (data || []).map((r) => r.tag).filter(Boolean)
      })
    }

    const tags = await getAllTags()

    if (with_usage === 'true') {
      // Paged: crm_lead_tags grows with every tag applied, and PostgREST
      // truncates a plain select at 1000 rows with no error — see
      // fetchAllRows in _db.js.
      const links = await fetchAllRows(() =>
        supabase.from('crm_lead_tags').select('tag_id').order('tag_id'))
      const counts = new Map()
      for (const l of links) counts.set(l.tag_id, (counts.get(l.tag_id) || 0) + 1)
      return res.status(200).json({
        success: true,
        count: tags.length,
        data: tags.map((t) => ({ ...t, usage_count: counts.get(t.id) || 0 }))
      })
    }

    return res.status(200).json({ success: true, count: tags.length, data: tags })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}

// POST /api/tags                  { name, color? }         -> create (or reuse) a tag
// POST /api/tags?action=assign    { tag_id, lead_ids: [] } -> bulk-apply a tag to leads
async function handlePost(req, res) {
  if (req.query.action === 'assign') {
    return handleAssign(req, res)
  }

  try {
    const body = req.body || {}
    const clean = (body.name || '').trim()

    if (!clean) {
      return res.status(400).json({ success: false, error: 'name is required' })
    }
    if (clean.length > 100) {
      return res.status(400).json({ success: false, error: 'name is too long (100 characters max)' })
    }

    // crm_tags.name is UNIQUE and matched case-insensitively here, so
    // "SaaS Connect" and "saas connect" can't become two tags that render
    // identically — the same casing bug that duplicated people rows. An
    // existing tag is returned rather than erroring: the caller wanted a tag
    // with this name, and there is one.
    const existing = await getAllTags()
    const hit = existing.find((t) => t.name.trim().toLowerCase() === clean.toLowerCase())
    if (hit) {
      return res.status(200).json({ success: true, data: hit, created: false })
    }

    const { data, error } = await supabase
      .from('crm_tags')
      .insert([{ name: clean, color: body.color || TAG_COLORS[existing.length % TAG_COLORS.length] }])
      .select()
      .single()

    if (error) throw error
    return res.status(201).json({ success: true, data, created: true })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}

async function handleAssign(req, res) {
  try {
    const body = req.body || {}
    const tagId = body.tag_id
    const ids = [...new Set((body.lead_ids || []).filter(Boolean))]

    if (!tagId) {
      return res.status(400).json({ success: false, error: 'tag_id is required' })
    }
    if (!ids.length) {
      return res.status(400).json({ success: false, error: 'lead_ids must be a non-empty array' })
    }

    // Chunked at 200 and upserted on the (lead_id, tag_id) primary key, so
    // re-tagging a lead already carrying the tag is a no-op, not a 23505.
    let applied = 0
    for (let i = 0; i < ids.length; i += 200) {
      const rows = ids.slice(i, i + 200).map((lead_id) => ({ lead_id, tag_id: tagId }))
      const { data, error } = await supabase
        .from('crm_lead_tags')
        .upsert(rows, { onConflict: 'lead_id,tag_id', ignoreDuplicates: true })
        .select('lead_id')
      if (error) throw error
      applied += (data || []).length
    }

    return res.status(200).json({ success: true, requested: ids.length, applied })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}

// PATCH /api/tags?id=5  { name } -- rename in place. crm_lead_tags points at
// the id, so every lead carrying the tag follows the rename. There is
// deliberately no delete for a tag itself (see CLAUDE.md, "Tags are lists") —
// only DELETE below, which unassigns a tag from one lead.
async function handlePatch(req, res) {
  try {
    const { id } = req.query
    if (!id) {
      return res.status(400).json({ success: false, error: 'id query param is required' })
    }

    const clean = (req.body?.name || '').trim()
    if (!clean) {
      return res.status(400).json({ success: false, error: 'name is required' })
    }

    const { data, error } = await supabase
      .from('crm_tags')
      .update({ name: clean })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return res.status(200).json({ success: true, data })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}

// DELETE /api/tags?lead_id=42&tag_id=5 -- unassign a tag from one lead. This
// never deletes the tag row itself.
async function handleDelete(req, res) {
  try {
    const { lead_id, tag_id } = req.query
    if (!lead_id || !tag_id) {
      return res.status(400).json({ success: false, error: 'lead_id and tag_id query params are required' })
    }

    const { error } = await supabase
      .from('crm_lead_tags')
      .delete()
      .eq('lead_id', lead_id)
      .eq('tag_id', tag_id)

    if (error) throw error
    return res.status(200).json({ success: true })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}
