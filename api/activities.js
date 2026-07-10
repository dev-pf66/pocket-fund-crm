import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

function authenticate(req) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key
  const validKey = process.env.CRM_API_KEY
  return apiKey === validKey
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

async function handleGet(req, res) {
  try {
    const { lead_id, activity_type, limit = 50 } = req.query

    let query = supabase
      .from('crm_lead_activities')
      .select(`
        *,
        lead:crm_leads(name, firm_name, stage)
      `)
      .order('activity_date', { ascending: false })
      .limit(parseInt(limit))

    if (lead_id) {
      query = query.eq('lead_id', lead_id)
    }

    if (activity_type) {
      query = query.eq('activity_type', activity_type)
    }

    const { data, error } = await query

    if (error) throw error

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

async function handlePost(req, res) {
  try {
    const body = req.body || {}
    const { lead_id, activity_type, notes, activity_date, logged_by } = body

    if (!lead_id) {
      return res.status(400).json({ success: false, error: 'lead_id is required' })
    }

    if (!activity_type || !VALID_ACTIVITY_TYPES.includes(activity_type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid activity_type. Must be one of: ${VALID_ACTIVITY_TYPES.join(', ')}`
      })
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
