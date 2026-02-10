import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// API key authentication
function authenticate(req) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key
  const validKey = process.env.CRM_API_KEY || 'your-secret-api-key-here'

  if (apiKey !== validKey) {
    return false
  }
  return true
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // Authenticate
  if (!authenticate(req)) {
    return res.status(401).json({ error: 'Unauthorized. Provide valid x-api-key header.' })
  }

  try {
    const { stage, lead_type, limit = 100 } = req.query

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
    return res.status(500).json({
      success: false,
      error: error.message
    })
  }
}
