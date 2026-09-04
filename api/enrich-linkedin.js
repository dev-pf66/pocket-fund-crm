import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { isAuthorized } from './_auth.js'
import { requireEnv } from './_env.js'
import { isLinkedInUrl, nameFromLinkedInUrl, linkedInProfileSlug } from '../src/lib/linkedin.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

const LEAD_TYPES = ['PE Firm', 'Family Office', 'Independent Sponsor', 'Other']

// This endpoint has no access to LinkedIn. It summarises what the CRM already
// holds; the URL is an identifier, not a source.
//
// It used to ask the model to "generate realistic and plausible professional
// enrichment data" from the URL slug and write the result to
// linkedin_headline / current_position / past_experience / education as
// though it were fact. All three leads it ever ran on had a blank firm name,
// so it invented one each — Venn Capital, Stride Capital, Milestone Capital
// Partners — plus degrees from ESCP, IIM Ahmedabad and ISB, and stamped the
// rows `enrichment_status: 'enriched'`. Those four columns are no longer
// written by anything. Do not reintroduce them here.
function buildPrompt(facts) {
  const lines = Object.entries(facts)
    .filter(([, v]) => String(v || '').trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n')

  return `You are writing a short internal CRM note for Pocket Fund's outreach team.

Use ONLY the facts listed below. Do not add employers, job titles, schools, locations, dates, deal history, mutual connections, or anything else that is not stated here. You cannot see the LinkedIn profile. If the facts are too thin to say anything useful, return an empty summary — that is the correct answer, not a failure.

Facts on record:
${lines}

Respond with JSON only, no markdown:
{
  "summary": "2-3 sentences on what we know about this lead and how to approach them, drawn strictly from the facts above. Empty string if there is nothing worth saying.",
  "suggested_lead_type": "One of: ${LEAD_TYPES.join(', ')} — only if the facts above make it clear. Empty string otherwise."
}`
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

  if (!requireEnv(res, ['ANTHROPIC_API_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])) return

  if (!(await isAuthorized(req))) {
    return res.status(401).json({ error: 'Unauthorized. Sign in or provide a valid x-api-key header.' })
  }

  const { leadId, linkedinUrl, context } = req.body

  if (!linkedinUrl) {
    return res.status(400).json({ error: 'linkedinUrl is required' })
  }

  if (!isLinkedInUrl(linkedinUrl)) {
    return res.status(400).json({ error: 'Invalid LinkedIn URL' })
  }

  if (!linkedInProfileSlug(linkedinUrl)) {
    return res.status(400).json({ error: 'Not a LinkedIn personal profile URL (expected /in/...)' })
  }

  // Preview mode: leadId omitted. Summarise the context the caller supplies
  // without touching the DB. Used by the Add Lead form.
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

      await supabase
        .from('crm_leads')
        .update({ enrichment_status: 'enriching' })
        .eq('id', leadId)
    }

    // Deterministic, not inferred: split the slug or return nothing. The form
    // asks the user rather than filing someone as "Liroyhaddad".
    const suggestedName = nameFromLinkedInUrl(linkedinUrl)

    const facts = {
      Name: lead.name,
      Firm: lead.firm_name,
      'Lead type': lead.lead_type,
      'Deal criteria': lead.deal_criteria,
      'Notes on file': lead.notes
    }
    const hasFacts = Object.values(facts).some(v => String(v || '').trim())

    // Nothing on file means nothing to summarise. Say so instead of inventing
    // a profile — and don't spend a model call finding that out.
    if (!hasFacts) {
      const payload = {
        linkedin_url: linkedinUrl,
        suggested_name: suggestedName,
        suggested_lead_type: '',
        enrichment_notes: '',
        insufficient_context: true
      }

      if (previewMode) {
        return res.status(200).json({ success: true, preview: true, enrichment: payload })
      }

      await supabase
        .from('crm_leads')
        .update({
          linkedin_url: linkedinUrl,
          enrichment_status: 'no_context',
          enriched_at: new Date().toISOString()
        })
        .eq('id', leadId)

      return res.status(200).json({ success: true, enrichment: payload })
    }

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: buildPrompt(facts) }]
    })

    const rawText = message.content[0].text.trim()
    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let parsed
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      if (!previewMode) {
        await supabase
          .from('crm_leads')
          .update({ enrichment_status: 'failed' })
          .eq('id', leadId)
      }
      return res.status(500).json({ error: 'Failed to parse AI response', raw: rawText })
    }

    const summary = String(parsed.summary || '').slice(0, 1200)
    // Anything outside the fixed list is the model freelancing — drop it.
    const rawType = String(parsed.suggested_lead_type || '').trim()
    const suggestedLeadType = LEAD_TYPES.includes(rawType) ? rawType : ''

    const payload = {
      linkedin_url: linkedinUrl,
      suggested_name: suggestedName,
      suggested_lead_type: suggestedLeadType,
      enrichment_notes: summary,
      insufficient_context: false
    }

    if (previewMode) {
      return res.status(200).json({ success: true, preview: true, enrichment: payload })
    }

    const { error: updateError } = await supabase
      .from('crm_leads')
      .update({
        linkedin_url: linkedinUrl,
        enrichment_status: 'summarized',
        enriched_at: new Date().toISOString()
      })
      .eq('id', leadId)

    if (updateError) throw updateError

    if (summary) {
      await supabase
        .from('crm_lead_activities')
        .insert([{
          lead_id: leadId,
          activity_type: 'note',
          activity_date: new Date().toISOString(),
          notes: `AI summary of CRM context (no LinkedIn data was fetched): ${summary}`
        }])
    }

    return res.status(200).json({ success: true, enrichment: payload })
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
