/**
 * CRM API — supporting surfaces: sample deals, settings, email templates,
 * transcripts (+ AI analysis), tags, lead scoring, LinkedIn enrichment,
 * activity feed, field options, and lead type options.
 */

import { supabase } from '../supabase'
import { cacheGet, cacheSet, cacheClear } from './core'
import { updateLead } from './leads'

// ============================================================================
// SAMPLE DEALS API
// ============================================================================

/**
 * Get all sample deals
 */
export async function getSampleDeals(filters = {}) {
  let query = supabase
    .from('crm_sample_deals')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (filters.industry) query = query.eq('industry', filters.industry)
  if (filters.client_type) query = query.eq('client_type', filters.client_type)

  const { data, error } = await query
  if (error) throw error
  return data || []
}


/**
 * Create sample deal
 */
export async function createSampleDeal(dealData, currentPersonId) {
  const { data, error } = await supabase
    .from('crm_sample_deals')
    .insert([{
      ...dealData,
      created_by: currentPersonId
    }])
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Update sample deal
 */
export async function updateSampleDeal(id, updates) {
  const { data, error } = await supabase
    .from('crm_sample_deals')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Delete (deactivate) sample deal
 */
export async function deleteSampleDeal(id) {
  const { data, error } = await supabase
    .from('crm_sample_deals')
    .update({ is_active: false })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}


// ============================================================================
// SETTINGS API
// ============================================================================

/**
 * Get CRM settings (cached for 60s to avoid redundant fetches)
 */
let _settingsCache = null
let _settingsCacheTime = 0
const SETTINGS_CACHE_TTL = 60000

export async function getCRMSettings() {
  const now = Date.now()
  if (_settingsCache && (now - _settingsCacheTime) < SETTINGS_CACHE_TTL) {
    return _settingsCache
  }

  const { data, error } = await supabase
    .from('crm_settings')
    .select('*')
    .eq('id', 1)
    .single()

  if (error) throw error
  _settingsCache = data
  _settingsCacheTime = now
  return data
}

// ============================================================================
// Email Templates
// ============================================================================

export async function getEmailTemplates() {
  const { data, error } = await supabase
    .from('crm_email_templates')
    .select('*')
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw error
  return data || []
}

export async function createEmailTemplate(templateData) {
  const { data, error } = await supabase
    .from('crm_email_templates')
    .insert([templateData])
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateEmailTemplate(id, updates) {
  const { data, error } = await supabase
    .from('crm_email_templates')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteEmailTemplate(id) {
  const { error} = await supabase
    .from('crm_email_templates')
    .update({ is_active: false })
    .eq('id', id)

  if (error) throw error
}

// ============================================================================
// Analytics
// ============================================================================

// ============================================================================
// Transcripts
// ============================================================================

export async function getLeadTranscripts(leadId) {
  const { data, error } = await supabase
    .from('crm_transcripts')
    .select('*')
    .eq('lead_id', leadId)
    .order('call_date', { ascending: false })

  if (error) throw error
  return data || []
}

export async function createTranscript(transcriptData) {
  const { data, error } = await supabase
    .from('crm_transcripts')
    .insert([transcriptData])
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteTranscript(id) {
  const { error } = await supabase
    .from('crm_transcripts')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// ============================================================================
// TAGS
// ============================================================================

export async function getTags() {
  const { data, error } = await supabase
    .from('crm_tags')
    .select('*')
    .order('name', { ascending: true })

  if (error) throw error
  return data || []
}

export async function getLeadTags(leadId) {
  const { data, error } = await supabase
    .from('crm_lead_tags')
    .select(`
      *,
      tag:crm_tags(*)
    `)
    .eq('lead_id', leadId)

  if (error) throw error
  return data?.map(lt => lt.tag) || []
}

export async function addTagToLead(leadId, tagId) {
  const { data, error } = await supabase
    .from('crm_lead_tags')
    .insert([{ lead_id: leadId, tag_id: tagId }])
    .select()

  if (error) throw error
  return data
}

export async function removeTagFromLead(leadId, tagId) {
  const { error } = await supabase
    .from('crm_lead_tags')
    .delete()
    .eq('lead_id', leadId)
    .eq('tag_id', tagId)

  if (error) throw error
}

// ============================================================================
// LEAD SCORING
// ============================================================================

export async function calculateLeadScore(leadId) {
  const { data, error } = await supabase.rpc('calculate_lead_score', {
    p_lead_id: leadId
  })

  if (error) throw error
  return data
}

// ============================================================================
// LINKEDIN ENRICHMENT
// ============================================================================

/**
 * Enrich lead from LinkedIn URL using AI-powered enrichment.
 * Calls the /api/enrich-linkedin serverless function which uses Claude
 * to generate structured enrichment data based on the lead's info.
 */
export async function enrichLeadFromLinkedIn(leadId, linkedinUrl) {
  // Immediately mark as enriching in local state
  await updateLead(leadId, {
    linkedin_url: linkedinUrl,
    enrichment_status: 'enriching'
  })

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')

  try {
    const response = await fetch('/api/enrich-linkedin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        leadId,
        linkedinUrl
      })
    })

    const result = await response.json()

    if (!response.ok || !result.success) {
      // Mark as failed
      await updateLead(leadId, { enrichment_status: 'failed' })
      throw new Error(result.error || 'Enrichment failed')
    }

    return result.enrichment
  } catch (error) {
    // Ensure status is set to failed on any error
    try {
      await updateLead(leadId, { enrichment_status: 'failed' })
    } catch { /* ignore secondary error */ }
    throw error
  }
}

/**
 * Preview-enrich from a LinkedIn URL WITHOUT saving a lead.
 * Used by the Add Lead form to pre-fill fields before the lead exists.
 * Returns { suggested_name, suggested_lead_type, linkedin_headline, current_position, past_experience, education, enrichment_notes }.
 */
export async function previewLinkedInEnrichment(linkedinUrl, context = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')
  const response = await fetch('/api/enrich-linkedin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ linkedinUrl, context })
  })

  const result = await response.json()
  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Enrichment preview failed')
  }
  return result.enrichment
}

// ============================================================================
// ACTIVITY FEED
// ============================================================================

/**
 * Get recent activity feed
 */
export async function getRecentActivity(limit = 15) {
  const { data, error } = await supabase.rpc('get_recent_activity', {
    limit_count: limit
  })

  if (error) throw error
  return data || []
}


/**
 * Log activity manually (for actions not covered by triggers)
 */
export async function logActivityManual(activityData) {
  const { error } = await supabase.rpc('log_activity', {
    p_user_id: activityData.user_id,
    p_user_name: activityData.user_name,
    p_action_type: activityData.action_type,
    p_description: activityData.description,
    p_entity_type: activityData.entity_type || null,
    p_entity_id: activityData.entity_id || null,
    p_entity_name: activityData.entity_name || null,
    p_metadata: activityData.metadata || null
  })

  if (error) throw error
}

// ============================================================================
// AI TRANSCRIPT ANALYSIS
// ============================================================================

/**
 * Send a transcript to the serverless function for AI analysis.
 * Returns the analysis object or throws on failure.
 */
export async function analyzeTranscript(transcriptId, transcriptText) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')

  const response = await fetch('/api/analyze-transcript', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({
      transcript_id: transcriptId,
      transcript_text: transcriptText
    })
  })

  const result = await response.json()

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Analysis failed')
  }

  return result.analysis
}

// ============================================================================
// GENERIC FIELD OPTIONS (industry, deal_size, location, lead_source)
// ============================================================================
// Restored after the cleanup commit dropped them. useFieldOptions and
// useLeadTypes still import these so dropdowns across the app depend on
// them.

export async function getFieldOptions(fieldName) {
  const cacheKey = `field_options:${fieldName}`
  const cached = cacheGet(cacheKey, 60000)
  if (cached) return cached
  const { data, error } = await supabase
    .from('crm_field_options')
    .select('*')
    .eq('field_name', fieldName)
    .order('sort_order', { ascending: true })
    .order('value', { ascending: true })
  if (error) throw error
  cacheSet(cacheKey, data)
  return data
}

export async function addFieldOption(fieldName, value) {
  const { data, error } = await supabase
    .from('crm_field_options')
    .insert([{ field_name: fieldName, value: value.trim(), sort_order: 999 }])
    .select()
    .single()
  if (error) throw error
  cacheClear(`field_options:${fieldName}`)
  return data
}

export async function deleteFieldOption(id, fieldName) {
  const { error } = await supabase
    .from('crm_field_options')
    .delete()
    .eq('id', id)
  if (error) throw error
  cacheClear(`field_options:${fieldName}`)
}

// ============================================================================
// LEAD TYPE OPTIONS
// ============================================================================

export async function getLeadTypeOptions() {
  const cached = cacheGet('lead_type_options', 60000)
  if (cached) return cached
  const { data, error } = await supabase
    .from('crm_lead_type_options')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  cacheSet('lead_type_options', data)
  return data
}

export async function addLeadTypeOption(name) {
  const { data, error } = await supabase
    .from('crm_lead_type_options')
    .insert([{ name: name.trim(), sort_order: 999 }])
    .select()
    .single()
  if (error) throw error
  cacheClear('lead_type_options')
  return data
}

export async function deleteLeadTypeOption(id) {
  const { error } = await supabase
    .from('crm_lead_type_options')
    .delete()
    .eq('id', id)
  if (error) throw error
  cacheClear('lead_type_options')
}
