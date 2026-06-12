import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { isAuthorized } from './_auth.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!(await isAuthorized(req))) {
    return res.status(401).json({ error: 'Unauthorized. Sign in or provide a valid x-api-key header.' })
  }

  const { leadId, linkedinUrl, context } = req.body

  if (!linkedinUrl) {
    return res.status(400).json({ error: 'linkedinUrl is required' })
  }

  if (!isValidLinkedInUrl(linkedinUrl)) {
    return res.status(400).json({ error: 'Invalid LinkedIn URL' })
  }

  // Preview mode: leadId omitted. Generate enrichment from provided context
  // without touching the DB. Used by the Add Lead form to pre-fill fields.
  const previewMode = !leadId

  try {
    let lead
    if (previewMode) {
      lead = {
        name: context?.name || '',
        firm_name: context?.firm_name || '',
        lead_type: context?.lead_type || '',
        notes: '',
        deal_criteria: ''
      }
    } else {
      const { data, error: fetchError } = await supabase
        .from('crm_leads')
        .select('*')
        .eq('id', leadId)
        .single()

      if (fetchError || !data) {
        return res.status(404).json({ error: 'Lead not found' })
      }
      lead = data

      // Mark as enriching
      await supabase
        .from('crm_leads')
        .update({ enrichment_status: 'enriching' })
        .eq('id', leadId)
    }

    // Extract profile slug from URL for hints
    const urlPath = new URL(linkedinUrl).pathname
    const profileSlug = urlPath.replace(/^\/in\//, '').replace(/\/$/, '')

    const previewInstruction = previewMode
      ? `\n\nSince we're pre-filling an Add Lead form, ALSO infer a likely name (from the LinkedIn slug — format "first-last" → "First Last") and lead_type ("PE Firm", "Family Office", "Independent Sponsor", or "Other") based on the profile slug and firm name. Include a suggested_name and suggested_lead_type field in your response.`
      : ''

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

Based on this person's name, firm, role type (${lead.lead_type}), and LinkedIn profile slug, generate plausible professional details. For someone at "${lead.firm_name || 'their firm'}" who is a "${lead.lead_type || 'finance professional'}", what would their background likely look like?${previewInstruction}

Respond with this exact JSON structure:
{
  "linkedin_headline": "A realistic LinkedIn headline for this person (e.g., 'Managing Partner at XYZ Capital | Private Equity | Growth Investments')",
  "current_position": "Their most likely current role and title at their firm",
  "past_experience": "2-3 bullet points of plausible past roles, separated by newlines",
  "education": "Most likely educational background (e.g., 'MBA, Wharton School of Business; BS Finance, NYU')",
  "enrichment_notes": "Brief summary of key insights about this person's likely background and how to approach them"${previewMode ? `,
  "suggested_name": "Inferred name from LinkedIn slug (First Last format)",
  "suggested_lead_type": "One of: PE Firm, Family Office, Independent Sponsor, Other"` : ''}
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
      if (!previewMode) {
        await supabase
          .from('crm_leads')
          .update({ enrichment_status: 'failed' })
          .eq('id', leadId)
      }
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

    if (previewMode) {
      return res.status(200).json({
        success: true,
        preview: true,
        enrichment: {
          ...validatedData,
          enrichment_notes: enrichmentData.enrichment_notes || '',
          suggested_name: String(enrichmentData.suggested_name || '').slice(0, 120),
          suggested_lead_type: String(enrichmentData.suggested_lead_type || '').slice(0, 40)
        }
      })
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

    if (!previewMode) {
      try {
        await supabase
          .from('crm_leads')
          .update({ enrichment_status: 'failed' })
          .eq('id', leadId)
      } catch { /* ignore */ }
    }

    return res.status(500).json({ success: false, error: error.message })
  }
}
