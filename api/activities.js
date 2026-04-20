import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

function authenticate(req) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key
  const validKey = process.env.CRM_API_KEY
  return apiKey === validKey
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (!authenticate(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

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
