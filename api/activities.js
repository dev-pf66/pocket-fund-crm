import { createClient } from '@supabase/supabase-js'
import { fetchAllRows } from './_db.js'
import { requireEnv } from './_env.js'
import { resolvePersonByEmail } from './_people.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

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

// Matches the crm_lead_activities activity_type vocabulary used by the app.
const VALID_ACTIVITY_TYPES = ['call', 'email', 'linkedin_message', 'meeting', 'sample_sent', 'proposal_sent', 'note']

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (!requireEnv(res, ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRM_API_KEY'])) return

  if (!authenticate(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method === 'GET') {
    return handleGet(req, res)
  } else if (req.method === 'POST') {
    return handlePost(req, res)
  } else {
    return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' })
  }
}

export async function handleGet(req, res) {
  try {
    const { lead_id, activity_type, limit = 50 } = req.query

    // Paged past PostgREST's silent 1,000-row cap (see _db.js).
    const data = await fetchAllRows(() => {
      let query = supabase
        .from('crm_lead_activities')
        .select(`
          *,
          lead:crm_leads(name, firm_name, stage)
        `)
        .order('activity_date', { ascending: false })
        .order('id', { ascending: false })

      if (lead_id) {
        query = query.eq('lead_id', lead_id)
      }

      if (activity_type) {
        query = query.eq('activity_type', activity_type)
      }

      return query
    }, { maxRows: parseInt(limit) || 50 })

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    })
  }
}

export async function handlePost(req, res) {
  try {
    const body = req.body || {}
    const { lead_id, activity_type, notes, activity_date } = body
    let logged_by = body.logged_by

    if (!lead_id) {
      return res.status(400).json({ success: false, error: 'lead_id is required' })
    }

    if (!activity_type || !VALID_ACTIVITY_TYPES.includes(activity_type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid activity_type. Must be one of: ${VALID_ACTIVITY_TYPES.join(', ')}`
      })
    }

    // logged_by_email: the scoreboard credits calls by logged_by, so an
    // unattributed activity is a call nobody made. See api/_people.js.
    if ((logged_by === undefined || logged_by === null || logged_by === '') &&
        typeof body.logged_by_email === 'string' && body.logged_by_email.trim()) {
      const who = await resolvePersonByEmail(supabase, body.logged_by_email, 'logged_by_email')
      if (who.error) return res.status(400).json({ success: false, error: who.error })
      logged_by = who.id
    }

    const date = activity_date || new Date().toISOString()

    const { data, error } = await supabase
      .from('crm_lead_activities')
      .insert([{
        lead_id,
        activity_type,
        notes: notes || null,
        activity_date: date,
        logged_by: logged_by || null
      }])
      .select()
      .single()

    if (error) throw error

    // Mirror the client-side logActivity: stamp the lead so staleness and
    // the Today queue reflect this touch immediately.
    await supabase
      .from('crm_leads')
      .update({
        last_activity_date: date,
        last_activity_type: activity_type
      })
      .eq('id', lead_id)

    return res.status(201).json({ success: true, data })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    })
  }
}
