import { createClient } from '@supabase/supabase-js'
import { requireEnv } from './_env.js'
import { fetchAllRows } from './_db.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (!requireEnv(res, ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRM_API_KEY'])) return

  if (!authenticate(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    // Paged: every number below is a .filter().length over this array, so a
    // silent 1000-row truncation would report wrong conversion rates.
    const leads = await fetchAllRows(() => supabase
      .from('crm_leads')
      .select('id, stage, lead_source'))

    // Calculate analytics
    const stages = {
      cold_outreach: leads.filter(l => l.stage === 'cold_outreach').length,
      responded: leads.filter(l => l.stage === 'responded').length,
      warm_lead: leads.filter(l => l.stage === 'warm_lead').length,
      active_conversation: leads.filter(l => l.stage === 'active_conversation').length,
      client: leads.filter(l => l.stage === 'client').length
    }

    const conversion = {
      ...stages,
      cold_to_responded_rate: stages.cold_outreach > 0 ? Math.round((stages.responded / stages.cold_outreach) * 100) : 0,
      responded_to_warm_rate: stages.responded > 0 ? Math.round((stages.warm_lead / stages.responded) * 100) : 0,
      warm_to_active_rate: stages.warm_lead > 0 ? Math.round((stages.active_conversation / stages.warm_lead) * 100) : 0,
      active_to_client_rate: stages.active_conversation > 0 ? Math.round((stages.client / stages.active_conversation) * 100) : 0,
      overall_rate: stages.cold_outreach > 0 ? Math.round((stages.client / stages.cold_outreach) * 100) : 0
    }

    // Lead sources
    const sourceMap = {}
    leads.forEach(lead => {
      const source = lead.lead_source || 'Unknown'
      if (!sourceMap[source]) {
        sourceMap[source] = { total: 0, clients: 0 }
      }
      sourceMap[source].total++
      if (lead.stage === 'client') {
        sourceMap[source].clients++
      }
    })

    const sources = Object.entries(sourceMap)
      .map(([source, data]) => ({
        source,
        total: data.total,
        clients: data.clients,
        conversion_rate: data.total > 0 ? Math.round((data.clients / data.total) * 100) : 0
      }))
      .sort((a, b) => b.conversion_rate - a.conversion_rate)

    return res.status(200).json({
      success: true,
      data: {
        total_leads: leads.length,
        conversion,
        sources,
        generated_at: new Date().toISOString()
      }
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    })
  }
}
