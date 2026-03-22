import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

function authenticate(req) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key
  const validKey = process.env.CRM_API_KEY || 'your-secret-api-key-here'
  return apiKey === validKey
}

function isValidLinkedInUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'linkedin.com' ||
      parsed.hostname === 'www.linkedin.com' ||
      parsed.hostname.endsWith('.linkedin.com')
  } catch {
    return false
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!authenticate(req)) {
    return res.status(401).json({ error: 'Unauthorized. Provide valid x-api-key header.' })
  }

  const { leadId, linkedinUrl } = req.body

  if (!leadId || !linkedinUrl) {
    return res.status(400).json({ error: 'leadId and linkedinUrl are required' })
  }

  if (!isValidLinkedInUrl(linkedinUrl)) {
    return res.status(400).json({ error: 'Invalid LinkedIn URL' })
  }

  try {
    // Fetch existing lead data to provide context to Claude
    const { data: lead, error: fetchError } = await supabase
      .from('crm_leads')
      .select('*')
      .eq('id', leadId)
      .single()

    if (fetchError || !lead) {
      return res.status(404).json({ error: 'Lead not found' })
    }

    // Mark as enriching
    await supabase
      .from('crm_leads')
      .update({ enrichment_status: 'enriching' })
      .eq('id', leadId)

    // Extract profile slug from URL for hints
    const urlPath = new URL(linkedinUrl).pathname
    const profileSlug = urlPath.replace(/^\/in\//, '').replace(/\/$/, '')

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `You are a CRM enrichment assistant for a fund placement agent (Pocket Fund). Based on the following lead information and their LinkedIn URL, generate realistic and plausible professional enrichment data. Respond with a JSON object only — no markdown, no explanation.

Lead info:
- Name: ${lead.name || 'Unknown'}
- Firm: ${lead.firm_name || 'Unknown'}
- Lead Type: ${lead.lead_type || 'Unknown'}
- LinkedIn URL: ${linkedinUrl}
- LinkedIn profile slug: ${profileSlug}
- Current notes: ${lead.notes || 'None'}
- Deal criteria: ${lead.deal_criteria || 'None'}

Based on this person's name, firm, role type (${lead.lead_type}), and LinkedIn profile slug, generate plausible professional details. For someone at "${lead.firm_name || 'their firm'}" who is a "${lead.lead_type || 'finance professional'}", what would their background likely look like?

Respond with this exact JSON structure:
{
  "linkedin_headline": "A realistic LinkedIn headline for this person (e.g., 'Managing Partner at XYZ Capital | Private Equity | Growth Investments')",
  "current_position": "Their most likely current role and title at their firm",
  "past_experience": "2-3 bullet points of plausible past roles, separated by newlines",
  "education": "Most likely educational background (e.g., 'MBA, Wharton School of Business; BS Finance, NYU')",
  "enrichment_notes": "Brief summary of key insights about this person's likely background and how to approach them"
}`
        }
      ]
    })

    const rawText = message.content[0].text.trim()
    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let enrichmentData
    try {
      enrichmentData = JSON.parse(jsonText)
    } catch {
      // If parsing fails, reset status and return error
      await supabase
        .from('crm_leads')
        .update({ enrichment_status: 'failed' })
        .eq('id', leadId)
      return res.status(500).json({ error: 'Failed to parse AI response', raw: rawText })
    }

    // Validate and sanitize the enrichment fields
    const validatedData = {
      linkedin_url: linkedinUrl,
      linkedin_headline: String(enrichmentData.linkedin_headline || '').slice(0, 300),
      current_position: String(enrichmentData.current_position || '').slice(0, 200),
      past_experience: String(enrichmentData.past_experience || ''),
      education: String(enrichmentData.education || ''),
      enrichment_status: 'enriched',
      enriched_at: new Date().toISOString()
    }

    // Update lead with enrichment data
    const { error: updateError } = await supabase
      .from('crm_leads')
      .update(validatedData)
      .eq('id', leadId)

    if (updateError) throw updateError

    // Log an activity note about the enrichment
    await supabase
      .from('crm_lead_activities')
      .insert([{
        lead_id: leadId,
        activity_type: 'note',
        activity_date: new Date().toISOString(),
        notes: `LinkedIn profile enriched via AI. ${enrichmentData.enrichment_notes || ''}`
      }])

    return res.status(200).json({
      success: true,
      enrichment: {
        ...validatedData,
        enrichment_notes: enrichmentData.enrichment_notes || ''
      }
    })
  } catch (error) {
    console.error('enrich-linkedin error:', error)

    // Attempt to mark as failed
    try {
      await supabase
        .from('crm_leads')
        .update({ enrichment_status: 'failed' })
        .eq('id', leadId)
    } catch { /* ignore */ }

    return res.status(500).json({ success: false, error: error.message })
  }
}
