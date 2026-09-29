/**
 * CRM API — supporting surfaces: sample deals, settings, email templates,
 * transcripts (+ AI analysis), tags, lead scoring, LinkedIn enrichment,
 * activity feed, field options, and lead type options.
 */

import { supabase } from '../supabase'
import { cacheGet, cacheSet, cacheClear, fetchAllRows } from './core'
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

/** The thresholds an admin may change, and what each one actually drives. */
export const STALENESS_SETTINGS = [
  {
    key: 'cold_outreach_threshold',
    label: 'Cold outreach goes stale after',
    stages: ['outreach'],
    hint: 'A lead you have contacted once and heard nothing back from.',
  },
  {
    key: 'warm_lead_threshold',
    label: 'A reply goes stale after',
    stages: ['responded'],
    hint: 'They answered. This is the clock on getting back to them.',
  },
  {
    key: 'active_conversation_threshold',
    label: 'An active conversation goes stale after',
    stages: ['meeting_booked', 'warm_active'],
    hint: 'Applies to booked meetings too — a meeting agreed and then ignored.',
  },
]

/**
 * Update the staleness thresholds.
 *
 * WHY THIS EXISTS: crm_settings had exactly one row, written 2026-02-05, and no
 * write path anywhere in the app — `getCRMSettings` was its only reference. Those
 * three numbers drive `calculateStaleness`, `getStaleLeads` and the Today tab's
 * marks, and measured 2026-09-29 they flagged 68% of the live pipeline as stale
 * (92% of meeting_booked). A staleness colour that is red on two thirds of the
 * board carries no information, and nobody could change it without direct
 * database access.
 *
 * Values are clamped to 1..365: a 0 would make every lead instantly stale, and a
 * negative would make the comparison nonsense. Only the three keys in
 * STALENESS_SETTINGS are writable — this is not a general settings PATCH.
 *
 * Records who changed it as well as when (migration 057). This is a SINGLE ROW
 * that changes the staleness colouring for the whole team on every board, and RLS
 * lets any signed-in user write it — the only gate is that Admin is admin-only at
 * the route. "Why is everything red this morning" needs an answer.
 */
export async function updateCRMSettings(updates, currentPersonId = null) {
  const allowed = STALENESS_SETTINGS.map(s => s.key)
  const clean = {}
  for (const key of allowed) {
    if (updates?.[key] === undefined) continue
    const n = Math.round(Number(updates[key]))
    if (!Number.isFinite(n)) throw new Error(`${key} must be a number`)
    if (n < 1 || n > 365) throw new Error(`${key} must be between 1 and 365 days`)
    clean[key] = n
  }
  if (Object.keys(clean).length === 0) throw new Error('Nothing to update')

  const { data, error } = await supabase
    .from('crm_settings')
    .update({ ...clean, updated_at: new Date().toISOString(), updated_by: currentPersonId })
    .eq('id', 1)
    .select()
    .single()
  if (error) throw error

  // getCRMSettings memoises for 60s; without this the board keeps colouring
  // against the old thresholds after a save and the change looks like it failed.
  _settingsCache = data
  _settingsCacheTime = Date.now()
  cacheClear('leads')
  cacheClear('dashboard')
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

/**
 * Palette for new tags. Cycled by tag count so a list of tags stays visually
 * distinguishable without asking anyone to pick a hex code.
 */
const TAG_COLORS = [
  '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
  '#84cc16', '#6366f1', '#ec4899', '#0ea5e9', '#f97316',
]

/**
 * Create a tag.
 *
 * WHY THIS DID NOT EXIST: `crm_tags` has been there since migration 003 with
 * eight seeded rows, and the app could read them, assign them and unassign
 * them — but never MAKE one. So the vocabulary was frozen at whatever the
 * migration happened to seed, which is why "Met at Conference" exists as a
 * generic label and no actual conference name ever could. Dev, Sept 2026: "more
 * tags like the conference I met them at or if they came through linkedin, so we
 * can create lists."
 *
 * Names are trimmed and matched case-insensitively against what exists, because
 * `crm_tags.name` is UNIQUE and "SaaS Connect" / "saas connect" would otherwise
 * be two tags that look like one — the same casing bug that duplicated people
 * rows. An existing tag is returned rather than erroring: the caller wanted a tag
 * with this name and there is one.
 */
export async function createTag(name, color = null) {
  const clean = (name || '').trim()
  if (!clean) throw new Error('A tag needs a name')
  if (clean.length > 100) throw new Error('Tag name is too long (100 characters max)')

  const existing = await getTags()
  const hit = existing.find(t => t.name.trim().toLowerCase() === clean.toLowerCase())
  if (hit) return hit

  const { data, error } = await supabase
    .from('crm_tags')
    .insert([{ name: clean, color: color || TAG_COLORS[existing.length % TAG_COLORS.length] }])
    .select()
    .single()
  if (error) throw error
  cacheClear('tags')
  return data
}

/**
 * Every lead↔tag link, as a Map of leadId -> [tag]. One read for the whole
 * board, so the Pipeline can filter by tag without a query per card.
 *
 * Paged: this is a join table over 596 leads and grows with every tag applied,
 * and a truncated page would silently drop tags off the end of the board.
 */
export async function getTagsByLead() {
  const rows = await fetchAllRows(() => supabase
    .from('crm_lead_tags')
    .select('lead_id, tag:crm_tags(id, name, color)')
    .order('lead_id'))
  const byLead = new Map()
  for (const r of rows) {
    if (!r.tag) continue
    if (!byLead.has(r.lead_id)) byLead.set(r.lead_id, [])
    byLead.get(r.lead_id).push(r.tag)
  }
  return byLead
}

/**
 * Tag counts, so the tag manager can say how many leads carry each one before
 * anyone renames or removes it.
 */
export async function getTagUsage() {
  const rows = await fetchAllRows(() => supabase
    .from('crm_lead_tags')
    .select('tag_id')
    .order('tag_id'))
  const counts = new Map()
  for (const r of rows) counts.set(r.tag_id, (counts.get(r.tag_id) || 0) + 1)
  return counts
}

/**
 * Rename a tag. The links in crm_lead_tags point at the id, so every lead
 * carrying it follows the rename — which is the point: "SaaS Connect 2026"
 * typed wrong once should be fixable without re-tagging anyone.
 */
export async function renameTag(tagId, name) {
  const clean = (name || '').trim()
  if (!clean) throw new Error('A tag needs a name')
  const { data, error } = await supabase
    .from('crm_tags')
    .update({ name: clean })
    .eq('id', tagId)
    .select()
    .single()
  if (error) throw error
  cacheClear('tags')
  return data
}

/**
 * Bulk-apply a tag to many leads at once — the other half of making lists
 * useful. Chunked at 200 like every other bulk write here, and idempotent:
 * re-tagging a lead that already carries the tag is a no-op rather than a
 * primary-key error, because (lead_id, tag_id) is the PK.
 */
export async function addTagToLeads(leadIds, tagId) {
  const ids = [...new Set((leadIds || []).filter(Boolean))]
  if (!ids.length || !tagId) return 0
  let applied = 0
  for (let i = 0; i < ids.length; i += 200) {
    const rows = ids.slice(i, i + 200).map(lead_id => ({ lead_id, tag_id: tagId }))
    const { data, error } = await supabase
      .from('crm_lead_tags')
      .upsert(rows, { onConflict: 'lead_id,tag_id', ignoreDuplicates: true })
      .select('lead_id')
    if (error) throw error
    applied += (data || []).length
  }
  return applied
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
 * Summarise the CRM context we hold for a lead, keyed by their LinkedIn URL.
 *
 * NOT a profile fetch — nothing reads LinkedIn. The endpoint summarises the
 * lead's own CRM fields and returns an empty summary when there is nothing on
 * file. It used to invent employers, titles and degrees and write them to
 * linkedin_headline / current_position / past_experience / education; it no
 * longer writes those columns at all.
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
 * Preview version of the above, for the Add Lead form — nothing is saved.
 *
 * Returns { linkedin_url, suggested_name, suggested_lead_type,
 * enrichment_notes, insufficient_context }. suggested_name is derived from
 * the URL slug deterministically and is '' when the slug won't split;
 * insufficient_context is true when the CRM had nothing to summarise.
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

// ============================================================================
// TASK TRACKER — manual task creation
// ============================================================================

// Create a task in the Sage task tracker from the CRM (the "Add Task" button
// on a pipeline card). Unlike fireTTEvent this awaits and returns the result
// so the UI can confirm success or surface the error. The tracker API key is
// server-side only, so this goes through the /api/events/fire dispatcher.
export async function createTrackerTask(payload) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')
  const res = await fetch('/api/events/fire', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ event_type: 'create_manual_task', payload })
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Failed to create task (${res.status})`)
  if (body?.result?.error) throw new Error(body.result.error)
  return body.result
}
