import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Valid enum values
const VALID_INVESTOR_TYPES = ['Individual LP', 'Family Office', 'Fund of Funds', 'Institutional', 'HNW Individual', 'Strategic', 'Other']
const VALID_STATUSES = ['prospect', 'contacted', 'in_conversation', 'committed', 'invested', 'passed']

// Fields allowed when creating/updating an investor
const ALLOWED_FIELDS = [
  'name', 'firm', 'email', 'phone', 'linkedin_url',
  'investor_type', 'status', 'check_size_min', 'check_size_max',
  'investment_focus', 'notes'
]

function authenticate(req) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key
  const validKey = process.env.CRM_API_KEY
  // Boolean(validKey) first: without it, an unset CRM_API_KEY makes
  // `undefined === undefined` true and every unauthenticated request
  // authenticates against the service-role client. Mirrors api/_auth.js.
  return Boolean(validKey) && apiKey === validKey
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (!authenticate(req)) {
    return res.status(401).json({ error: 'Unauthorized. Provide valid x-api-key header.' })
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
    const { id, status, investor_type, search, limit = 100 } = req.query

    // Single investor by ID
    if (id) {
      const { data, error } = await supabase
        .from('crm_investors')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ success: false, error: 'Investor not found' })
        }
        throw error
      }

      return res.status(200).json({ success: true, data })
    }

    // List investors with filters
    let query = supabase
      .from('crm_investors')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(parseInt(limit))

    if (status) {
      query = query.eq('status', status)
    }

    if (investor_type) {
      query = query.eq('investor_type', investor_type)
    }

    if (search) {
      const sanitized = search.replace(/[%_,.()"'\\]/g, '')
      if (sanitized) {
        query = query.or(`name.ilike.%${sanitized}%,firm.ilike.%${sanitized}%,email.ilike.%${sanitized}%`)
      }
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
    if (body.investor_type && !VALID_INVESTOR_TYPES.includes(body.investor_type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid investor_type. Must be one of: ${VALID_INVESTOR_TYPES.join(', ')}`
      })
    }

    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`
      })
    }

    // Validate check sizes are positive numbers if provided
    if (body.check_size_min !== undefined && body.check_size_min !== null) {
      const min = Number(body.check_size_min)
      if (isNaN(min) || min < 0) {
        return res.status(400).json({ success: false, error: 'check_size_min must be a positive number' })
      }
      body.check_size_min = min
    }

    if (body.check_size_max !== undefined && body.check_size_max !== null) {
      const max = Number(body.check_size_max)
      if (isNaN(max) || max < 0) {
        return res.status(400).json({ success: false, error: 'check_size_max must be a positive number' })
      }
      body.check_size_max = max
    }

    // Whitelist fields
    const insert = {}
    for (const field of ALLOWED_FIELDS) {
      if (body[field] !== undefined) {
        insert[field] = body[field]
      }
    }

    const { data, error } = await supabase
      .from('crm_investors')
      .insert(insert)
      .select()
      .single()

    if (error) throw error

    return res.status(201).json({ success: true, data })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}
