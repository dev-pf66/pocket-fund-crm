/**
 * CRM API - Sales lead management for Pocket Fund
 */

import { supabase } from './supabase'
import { normalizeLinkedInUrl, nameFromLinkedInUrl } from './linkedin'
import { IST_OFFSET_MS, istAddDays, istWeekStart } from './dateUtils'

// Accepts an optional utcMs so callers can get the IST date for a specific
// moment; defaults to now. All other code should call istToday() directly.
function istDateStr(utcMs = Date.now()) {
  return new Date(utcMs + IST_OFFSET_MS).toISOString().split('T')[0]
}

// Fire-and-forget post to the server-side event dispatcher.
// Never blocks the caller; errors are logged but swallowed.
async function fireTTEvent(event_type, payload) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return
    await fetch('/api/events/fire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ event_type, payload })
    })
  } catch (e) { console.error('fireTTEvent failed', e) }
}

// ============================================================================
// IN-MEMORY CACHE
// ============================================================================

const _cache = new Map()

function cacheGet(key, ttlMs) {
  const entry = _cache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.ts > ttlMs) {
    _cache.delete(key)
    return undefined
  }
  return entry.data
}

function cacheSet(key, data) {
  _cache.set(key, { data, ts: Date.now() })
}

export function cacheClear(prefix) {
  if (!prefix) { _cache.clear(); return }
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key)
  }
}

// Synchronous cache peek — lets components render immediately with cached data
// on mount (stale-while-revalidate), avoiding the spinner flash on sidebar nav.
// Uses a longer TTL than the fetchers because stale data is fine to show while
// the background refetch runs.
export function cachePeek(key, ttlMs = 5 * 60 * 1000) {
  return cacheGet(key, ttlMs)
}

// ============================================================================
// LEADS API
// ============================================================================

// Pipeline stage progression. Forward-only automation: replies and stage
// syncs may move a lead RIGHT along this list, never left. 'passed' is
// terminal and outside the order — automation never touches passed leads.
const STAGE_ORDER = ['new_lead', 'cold_outreach', 'responded', 'warm_lead', 'active_conversation', 'meeting_booked', 'client']
const stageRank = (stage) => STAGE_ORDER.indexOf(stage)

/**
 * Move a lead forward to targetStage only if it currently sits at an earlier
 * stage. Used by the reply→pipeline sync so an analyst marking "replied" on
 * an old entry can never drag a warm/meeting/client lead backwards.
 * Low-level on purpose: does NOT run the stage side effects (the caller is
 * the automation, so re-marking outreach as replied would double-count).
 */
export async function advanceLeadStage(leadId, targetStage, currentPersonId = null) {
  const { data: lead, error } = await supabase
    .from('crm_leads')
    .select('*')
    .eq('id', leadId)
    .single()
  if (error) throw error
  if (!lead) return null
  if (lead.stage === 'passed' || lead.stage === 'client') return lead
  if (stageRank(lead.stage) >= stageRank(targetStage)) return lead

  const oldStage = lead.stage
  const { data, error: updError } = await supabase
    .from('crm_leads')
    .update({ stage: targetStage })
    .eq('id', leadId)
    .select()
    .single()
  if (updError) throw updError

  await logActivity(leadId, {
    activity_type: 'note',
    notes: `Moved to ${targetStage.replace(/_/g, ' ')} (auto — outreach reply)`
  }, currentPersonId)

  cacheClear('leads')
  cacheClear('dashboard')
  fireTTEvent('lead_stage_changed', { lead: data, oldStage })
  return data
}

/**
 * Side effects of a user-initiated stage change, so the funnel numbers stay
 * honest whichever surface the analyst updates first:
 * - Lead reaches 'responded' (or beyond): its latest un-replied outreach
 *   entry flips to 'replied', keeping reply rate in sync with the pipeline.
 * - Lead enters 'meeting_booked': auto-log a 'meeting' activity — exactly
 *   what the Dashboard funnel counts — so meetings no longer depend on
 *   someone remembering the quick-log button.
 * Never throws: metrics side effects must not break the stage change itself.
 */
async function runStageSideEffects(lead, oldStage, newStage, currentPersonId = null) {
  try {
    const personId = currentPersonId ?? lead.assigned_to ?? lead.created_by ?? null

    // Reply sync: crossed into responded-or-later from an earlier stage.
    if (
      stageRank(newStage) >= stageRank('responded') &&
      (oldStage == null || (stageRank(oldStage) < stageRank('responded') && oldStage !== 'passed'))
    ) {
      const { data: rows } = await supabase
        .from('crm_outreach_log')
        .select('id, status')
        .eq('lead_id', lead.id)
        .in('status', ['sent', 'no_response'])
        .order('outreach_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
      if (rows?.length) {
        // Direct update (not updateOutreach) — the reply→stage hook would
        // otherwise re-enter here for no reason.
        await supabase.from('crm_outreach_log').update({ status: 'replied' }).eq('id', rows[0].id)
      }
    }

    // Meeting sync: entering the Meeting stage logs the meeting itself.
    if (newStage === 'meeting_booked' && oldStage !== 'meeting_booked') {
      await logActivity(lead.id, {
        activity_type: 'meeting',
        notes: 'Meeting — auto-logged from pipeline stage change'
      }, personId)
    }
  } catch (e) {
    console.error('Stage side effects failed (stage change itself succeeded):', e)
  }
}

/**
 * Get leads with optional filters. When personId is provided, restricts
 * results to leads the person created OR is assigned to, so each user
 * only sees their own book.
 */
export async function getLeads(filters = {}, personId = null) {
  const cacheKey = 'leads:' + (personId ?? 'all') + ':' + JSON.stringify(filters)
  const cached = cacheGet(cacheKey, 15000) // 15s TTL
  if (cached) return cached

  let query = supabase
    .from('crm_leads')
    .select('*')
    .order('updated_at', { ascending: false })

  if (filters.stage) query = query.eq('stage', filters.stage)
  if (filters.lead_type) query = query.eq('lead_type', filters.lead_type)
  if (filters.needs_sample_deals !== undefined) query = query.eq('needs_sample_deals', filters.needs_sample_deals)
  if (personId) query = query.or(`created_by.eq.${personId},assigned_to.eq.${personId}`)

  const { data, error } = await query
  if (error) throw error
  const result = data || []
  cacheSet(cacheKey, result)
  return result
}

/**
 * Get lead by ID with full details
 */
export async function getLeadById(id) {
  const { data, error } = await supabase
    .from('crm_leads')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

/**
 * Create new lead
 */
/**
 * Find a CRM lead whose linkedin_url matches the given URL after normalization.
 * Returns null if none found.
 */
/**
 * Look up a CRM lead by email (case-insensitive) or by a name+firm pair.
 * Used to avoid creating duplicate contacts when promoting outreach entries.
 */
export async function findLeadByEmailOrNameFirm({ email, name, firm_name }) {
  if (email) {
    const { data, error } = await supabase
      .from('crm_leads')
      .select('*')
      .ilike('email', email)
      .limit(1)
    if (error) throw error
    if (data?.length) return data[0]
  }
  if (name) {
    let q = supabase.from('crm_leads').select('*').ilike('name', name).limit(1)
    if (firm_name) q = q.ilike('firm_name', firm_name)
    const { data, error } = await q
    if (error) throw error
    if (data?.length) return data[0]
  }
  return null
}

export async function findLeadByLinkedInUrl(linkedinUrl) {
  if (!linkedinUrl) return null
  const normalized = normalizeLinkedInUrl(linkedinUrl)
  const { data, error } = await supabase
    .from('crm_leads')
    .select('*')
    .not('linkedin_url', 'is', null)
  if (error) throw error
  return data?.find(l => normalizeLinkedInUrl(l.linkedin_url) === normalized) || null
}

export async function createLead(leadData, currentPersonId) {
  // outreach_stage has a CHECK constraint allowing only specific values or
  // NULL; coerce an empty string ('Not set') to null so the insert passes.
  const clean = { ...leadData }
  if (clean.outreach_stage === '') clean.outreach_stage = null

  const { data, error } = await supabase
    .from('crm_leads')
    .insert([{
      ...clean,
      created_by: currentPersonId,
      last_activity_date: new Date().toISOString(),
      last_activity_type: 'created'
    }])
    .select()
    .single()

  if (error) throw error

  // Log creation activity
  await logActivity(data.id, {
    activity_type: 'note',
    activity_date: new Date().toISOString(),
    notes: 'Lead created in CRM'
  }, currentPersonId)

  cacheClear('leads')
  cacheClear('dashboard')
  return data
}

/**
 * Update lead
 */
export async function updateLead(id, updates, currentPersonId = null) {
  // Clean up updates object - remove undefined/null values and internal fields
  const cleanUpdates = {}
  Object.keys(updates).forEach(key => {
    // Skip internal fields that shouldn't be updated
    if (['id', 'created_at', 'updated_at', 'created_by_person', 'assigned_to_person', 'assigned_by_person'].includes(key)) {
      return
    }
    // Only include defined values
    if (updates[key] !== undefined) {
      cleanUpdates[key] = updates[key]
    }
  })

  // outreach_stage has a CHECK constraint (specific values or NULL); an
  // empty string from a "Not set" dropdown would violate it.
  if (cleanUpdates.outreach_stage === '') cleanUpdates.outreach_stage = null

  // If a stage change is in the updates, grab the prior stage so we can
  // fire lead_stage_changed with oldStage when it actually moves. Only
  // pay for the extra read when stage is in scope — most updates aren't
  // stage moves and shouldn't bear the cost.
  let priorStage = null
  if (cleanUpdates.stage !== undefined) {
    const { data: prior } = await supabase
      .from('crm_leads')
      .select('stage')
      .eq('id', id)
      .single()
    priorStage = prior?.stage ?? null
  }

  const { data, error } = await supabase
    .from('crm_leads')
    .update(cleanUpdates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Supabase update error:', error)
    throw error
  }
  cacheClear('leads')
  cacheClear('dashboard')

  // Fire AFTER the write succeeds so we never dispatch a stage event
  // for an update that errored out. Mirrors the moveLead path so R2
  // (responded), R3 (active_conversation), and R4 (client) trigger the
  // same TT tasks regardless of whether the stage moved via drag-drop
  // (moveLead) or an inline edit / form save (updateLead).
  if (cleanUpdates.stage !== undefined && priorStage !== data.stage) {
    fireTTEvent('lead_stage_changed', { lead: data, oldStage: priorStage })
    await runStageSideEffects(data, priorStage, data.stage, currentPersonId)
  }

  return data
}

/**
 * Move lead to new stage
 */
export async function moveLead(id, newStage, currentPersonId) {
  const { data: prior } = await supabase
    .from('crm_leads')
    .select('stage')
    .eq('id', id)
    .single()
  const oldStage = prior?.stage ?? null

  const { data, error } = await supabase
    .from('crm_leads')
    .update({ stage: newStage })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error

  // Log stage change
  await logActivity(id, {
    activity_type: 'note',
    activity_date: new Date().toISOString(),
    notes: `Moved to ${newStage.replace(/_/g, ' ')}`
  }, currentPersonId)

  cacheClear('leads')
  cacheClear('dashboard')

  fireTTEvent('lead_stage_changed', { lead: data, oldStage })

  await runStageSideEffects(data, oldStage, newStage, currentPersonId)

  return data
}

/**
 * Delete lead
 */
export async function deleteLead(id) {
  const { error } = await supabase
    .from('crm_leads')
    .delete()
    .eq('id', id)

  if (error) throw error
  cacheClear('leads')
  cacheClear('dashboard')
}

// ============================================================================
// ACTIVITIES API
// ============================================================================

/**
 * Get activities for a lead
 */
export async function getLeadActivities(leadId) {
  const { data, error } = await supabase
    .from('crm_lead_activities')
    .select(`
      *,
      logged_by_person:logged_by(id, name)
    `)
    .eq('lead_id', leadId)
    .order('activity_date', { ascending: false })

  if (error) throw error
  return data || []
}

/**
 * Log activity for a lead
 */
export async function logActivity(leadId, activityData, currentPersonId) {
  const activityDate = activityData.activity_date || new Date().toISOString()

  const { data: activity, error: activityError } = await supabase
    .from('crm_lead_activities')
    .insert([{
      lead_id: leadId,
      ...activityData,
      activity_date: activityDate,
      logged_by: currentPersonId
    }])
    .select()
    .single()

  if (activityError) throw activityError

  await supabase
    .from('crm_leads')
    .update({
      last_activity_date: activityDate,
      last_activity_type: activityData.activity_type
    })
    .eq('id', leadId)

  cacheClear('leads')
  cacheClear('dashboard')
  return activity
}


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
// DASHBOARD/ANALYTICS API
// ============================================================================

/**
 * Get stale leads (exceeded threshold since last activity)
 */
export async function getStaleLeads(personId = null) {
  const settings = await getCRMSettings()
  const leads = await getLeads({}, personId)

  return leads.filter(lead => {
    if (!lead.last_activity_date) return false
    if (lead.stage === 'client' || lead.stage === 'passed') return false

    const daysSince = getDaysBetween(
      new Date(lead.last_activity_date),
      new Date()
    )

    const thresholds = {
      new_lead: 999, // New leads don't go stale — they haven't been contacted yet
      cold_outreach: settings.cold_outreach_threshold,
      responded: settings.warm_lead_threshold, // Responded is in the warming phase — reuse warm threshold
      warm_lead: settings.warm_lead_threshold,
      active_conversation: settings.active_conversation_threshold,
      meeting_booked: settings.active_conversation_threshold, // Booked meetings go stale as fast as active talks
      reach_out_later: 999 // Use exact date instead
    }

    return daysSince > thresholds[lead.stage]
  })
}

/**
 * Get leads with follow-ups due today
 */
export async function getFollowUpsDueToday(personId = null) {
  const today = istDateStr()

  let query = supabase
    .from('crm_leads')
    .select('*')
    .or(`next_follow_up_date.eq.${today},reach_out_later_date.eq.${today}`)
    .neq('stage', 'passed')

  if (personId) query = query.or(`created_by.eq.${personId},assigned_to.eq.${personId}`)

  const { data, error } = await query

  if (error) throw error
  return data || []
}

/**
 * Get leads needing sample deals
 */
export async function getLeadsNeedingSamples(personId = null) {
  let query = supabase
    .from('crm_leads')
    .select('*')
    .eq('needs_sample_deals', true)
    .neq('stage', 'passed')

  if (personId) query = query.or(`created_by.eq.${personId},assigned_to.eq.${personId}`)

  const { data, error } = await query

  if (error) throw error
  return data || []
}

/**
 * Get active conversations gone stale (CRITICAL)
 */
export async function getActiveConversationsGoneStale(personId = null) {
  const settings = await getCRMSettings()
  const leads = await getLeads({ stage: 'active_conversation' }, personId)

  return leads.filter(lead => {
    if (!lead.last_activity_date) return false

    const daysSince = getDaysBetween(
      new Date(lead.last_activity_date),
      new Date()
    )

    return daysSince > settings.active_conversation_threshold
  })
}

/**
 * Get weekly call count
 */
export async function getWeeklyCallCount() {
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)

  const { data, error } = await supabase
    .from('crm_lead_activities')
    .select('id')
    .in('activity_type', ['call', 'meeting'])
    .gte('activity_date', weekAgo.toISOString())

  if (error) throw error
  return data?.length || 0
}

/**
 * Get pipeline statistics
 */
export async function getPipelineStats(personId = null) {
  const leads = await getLeads({}, personId)

  const stats = {
    new_lead: 0,
    cold_outreach: 0,
    responded: 0,
    warm_lead: 0,
    active_conversation: 0,
    meeting_booked: 0,
    client: 0,
    reach_out_later: 0,
    passed: 0,
    total: leads.length
  }

  leads.forEach(lead => {
    stats[lead.stage] = (stats[lead.stage] || 0) + 1
  })

  // Calculate percentages
  stats.new_pct = (stats.new_lead / stats.total) * 100
  stats.cold_pct = (stats.cold_outreach / stats.total) * 100
  stats.responded_pct = (stats.responded / stats.total) * 100
  stats.warm_pct = (stats.warm_lead / stats.total) * 100
  stats.active_pct = (stats.active_conversation / stats.total) * 100
  stats.client_pct = (stats.client / stats.total) * 100

  return stats
}

/**
 * Get weekly stats
 */
export async function getWeeklyStats(personId = null) {
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)

  let activitiesQuery = supabase
    .from('crm_lead_activities')
    .select('activity_type')
    .gte('activity_date', weekAgo.toISOString())
  if (personId) activitiesQuery = activitiesQuery.eq('created_by', personId)

  let leadsQuery = supabase
    .from('crm_leads')
    .select('stage, created_at, updated_at')
  if (personId) leadsQuery = leadsQuery.or(`created_by.eq.${personId},assigned_to.eq.${personId}`)

  const [activities, leads] = await Promise.all([activitiesQuery, leadsQuery])

  const stats = {
    discovery_calls: activities.data?.filter(a =>
      ['call', 'meeting'].includes(a.activity_type)
    ).length || 0,
    proposals_sent: activities.data?.filter(a =>
      a.activity_type === 'proposal_sent'
    ).length || 0,
    new_leads: leads.data?.filter(l =>
      new Date(l.created_at) >= weekAgo
    ).length || 0,
    closed_clients: leads.data?.filter(l =>
      l.stage === 'client' && new Date(l.updated_at) >= weekAgo
    ).length || 0
  }

  return stats
}


/**
 * Get complete CRM dashboard data
 */
export async function getCRMDashboardData(personId = null) {
  const cacheKey = 'dashboard:' + (personId ?? 'all')
  const cached = cacheGet(cacheKey, 15000)
  if (cached) return cached

  const [
    leads,
    staleLeads,
    followUps,
    needsSamples,
    activeStale,
    weeklyStats,
    pipelineStats,
    settings
  ] = await Promise.all([
    getLeads({}, personId),
    getStaleLeads(personId),
    getFollowUpsDueToday(personId),
    getLeadsNeedingSamples(personId),
    getActiveConversationsGoneStale(personId),
    getWeeklyStats(personId),
    getPipelineStats(personId),
    getCRMSettings()
  ])

  const result = {
    leads,
    staleLeads,
    followUps,
    needsSamples,
    activeStale,
    weeklyStats,
    pipelineStats,
    settings
  }
  cacheSet(cacheKey, result)
  return result
}


// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate days between two dates
 */
function getDaysBetween(date1, date2) {
  const diffTime = Math.abs(date2 - date1)
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return diffDays
}

/**
 * Calculate staleness for a lead
 */
export function calculateStaleness(lead, settings) {
  if (!lead.last_activity_date) {
    return { color: 'gray', days: null, status: 'no_activity' }
  }

  const daysSince = getDaysBetween(
    new Date(lead.last_activity_date),
    new Date()
  )

  const thresholds = {
    new_lead: 999,
    cold_outreach: settings.cold_outreach_threshold,
    responded: settings.warm_lead_threshold,
    warm_lead: settings.warm_lead_threshold,
    active_conversation: settings.active_conversation_threshold,
    meeting_booked: settings.active_conversation_threshold,
    client: 999,
    reach_out_later: 999,
    passed: 999
  }

  const threshold = thresholds[lead.stage]

  if (daysSince <= threshold * 0.5) {
    return { color: 'green', days: daysSince, status: 'fresh' }
  } else if (daysSince <= threshold) {
    return { color: 'yellow', days: daysSince, status: 'aging' }
  } else {
    return { color: 'red', days: daysSince, status: 'stale' }
  }
}


// ============================================================================
// INVESTORS API
// ============================================================================

/**
 * Get all investors with optional filters
 */
export async function getInvestors(filters = {}) {
  const cacheKey = 'investors:' + JSON.stringify(filters)
  const cached = cacheGet(cacheKey, 15000)
  if (cached) return cached

  let query = supabase
    .from('crm_investors')
    .select('*')
    .order('updated_at', { ascending: false })

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.investor_type) query = query.eq('investor_type', filters.investor_type)
  if (filters.search) {
    query = query.or(`name.ilike.%${filters.search}%,firm.ilike.%${filters.search}%,email.ilike.%${filters.search}%`)
  }

  const { data, error } = await query
  if (error) throw error
  const result = data || []
  cacheSet(cacheKey, result)
  return result
}

/**
 * Get investor by ID
 */
export async function getInvestorById(id) {
  const { data, error } = await supabase
    .from('crm_investors')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

/**
 * Create new investor
 */
export async function createInvestor(investorData, currentPersonId) {
  const { data, error } = await supabase
    .from('crm_investors')
    .insert([{
      ...investorData,
      created_by: currentPersonId
    }])
    .select()
    .single()

  if (error) throw error
  cacheClear('investors')
  return data
}

/**
 * Update investor
 */
export async function updateInvestor(id, updates) {
  const cleanUpdates = {}
  Object.keys(updates).forEach(key => {
    if (['id', 'created_at', 'updated_at', 'created_by'].includes(key)) return
    if (updates[key] !== undefined) {
      cleanUpdates[key] = updates[key]
    }
  })

  const { data, error } = await supabase
    .from('crm_investors')
    .update(cleanUpdates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  cacheClear('investors')
  return data
}

/**
 * Delete investor
 */
export async function deleteInvestor(id) {
  const { error } = await supabase
    .from('crm_investors')
    .delete()
    .eq('id', id)

  if (error) throw error
  cacheClear('investors')
}

/**
 * Get interactions for an investor
 */
export async function getInvestorInteractions(investorId) {
  const { data, error } = await supabase
    .from('crm_investor_interactions')
    .select(`
      *,
      logged_by_person:logged_by(id, name)
    `)
    .eq('investor_id', investorId)
    .order('interaction_date', { ascending: false })

  if (error) throw error
  return data || []
}

/**
 * Log interaction for an investor
 */
export async function logInvestorInteraction(investorId, interactionData, currentPersonId) {
  const { data, error } = await supabase
    .from('crm_investor_interactions')
    .insert([{
      investor_id: investorId,
      ...interactionData,
      logged_by: currentPersonId
    }])
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Delete investor interaction
 */
export async function deleteInvestorInteraction(id) {
  const { error } = await supabase
    .from('crm_investor_interactions')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// ============================================================================
// POTENTIAL PARTNERS
// ============================================================================

export async function getPartners(personId = null) {
  let q = supabase
    .from('crm_partners')
    .select('*')
    .order('updated_at', { ascending: false })
  if (personId) q = q.eq('created_by', personId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createPartner(partnerData, currentPersonId) {
  const { data, error } = await supabase
    .from('crm_partners')
    .insert([{ ...partnerData, created_by: currentPersonId }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updatePartner(id, updates) {
  const cleanUpdates = {}
  Object.keys(updates).forEach(key => {
    if (['id', 'created_at', 'updated_at', 'created_by'].includes(key)) return
    if (updates[key] !== undefined) cleanUpdates[key] = updates[key]
  })
  const { data, error } = await supabase
    .from('crm_partners')
    .update(cleanUpdates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function movePartner(id, stage) {
  const { data, error } = await supabase
    .from('crm_partners')
    .update({ stage })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletePartner(id) {
  const { error } = await supabase
    .from('crm_partners')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ============================================================================
// INDIAN SELLERS (buyside acquisition pipeline)
// ============================================================================
// Standalone from crm_leads on purpose: sellers are acquisition targets, not
// sales leads, and stay out of the sales funnel/outreach. Team-shared (open
// RLS), so no per-user filter by default.

export async function getSellers() {
  const { data, error } = await supabase
    .from('crm_sellers')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createSeller(sellerData, currentPersonId) {
  const { data, error } = await supabase
    .from('crm_sellers')
    .insert([{ ...sellerData, created_by: currentPersonId }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateSeller(id, updates) {
  const cleanUpdates = {}
  Object.keys(updates).forEach(key => {
    if (['id', 'created_at', 'updated_at', 'created_by'].includes(key)) return
    if (updates[key] !== undefined) cleanUpdates[key] = updates[key]
  })
  const { data, error } = await supabase
    .from('crm_sellers')
    .update(cleanUpdates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function moveSeller(id, stage) {
  const { data, error } = await supabase
    .from('crm_sellers')
    .update({ stage })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteSeller(id) {
  const { error } = await supabase
    .from('crm_sellers')
    .delete()
    .eq('id', id)
  if (error) throw error
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
// OUTREACH TRACKER
// ============================================================================

/**
 * Get outreach log entries
 */
export async function getOutreachLog(filters = {}, personId = null) {
  let query = supabase
    .from('crm_outreach_log')
    .select(`
      *,
      lead:crm_leads(id, name, firm_name, stage, outreach_stage),
      logged_by_person:logged_by(id, name)
    `)
    .order('outreach_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (filters.outreach_date) {
    query = query.eq('outreach_date', filters.outreach_date)
  }

  if (filters.outreach_type) {
    query = query.eq('outreach_type', filters.outreach_type)
  }

  if (filters.status) {
    query = query.eq('status', filters.status)
  }

  if (filters.days_back) {
    query = query
      .gte('outreach_date', istAddDays(istDateStr(), -filters.days_back))
      .lte('outreach_date', istDateStr())
  }

  if (personId) query = query.eq('logged_by', personId)

  const { data, error } = await query

  if (error) throw error
  return data || []
}

/**
 * Log an outreach activity
 */
export async function logOutreach(outreachData, currentPersonId, currentPersonName) {
  const { data, error } = await supabase
    .from('crm_outreach_log')
    .insert([{
      ...outreachData,
      logged_by: currentPersonId,
      outreach_date: outreachData.outreach_date || istDateStr()
    }])
    .select()
    .single()

  if (error) throw error

  // Log activity
  if (currentPersonName && data) {
    const typeLabel = outreachData.outreach_type?.replace(/_/g, ' ') || 'outreach'
    const description = `${currentPersonName} logged ${typeLabel} to ${outreachData.lead_name}${outreachData.firm_name ? ' at ' + outreachData.firm_name : ''}`

    try {
      await logActivityManual({
        user_id: currentPersonId,
        user_name: currentPersonName,
        action_type: 'outreach_logged',
        description,
        entity_type: 'outreach',
        entity_id: data.id,
        entity_name: outreachData.lead_name,
        metadata: {
          outreach_type: outreachData.outreach_type,
          firm: outreachData.firm_name,
          fit_score: outreachData.fit_score
        }
      })
    } catch (activityError) {
      console.error('Failed to log activity:', activityError)
    }
  }

  // /api/events/fire treats the payload AS the outreach row
  // (it does `onOutreachLogged({ outreach: payload })`), so send
  // the raw row — wrapping it would double-nest and the dispatcher
  // would silently bail out with missing_fields.
  fireTTEvent('outreach_logged', data)

  // An entry logged as already-replied belongs in the pipeline too.
  if (data.status === 'replied') {
    await syncReplyToPipeline(data, currentPersonId)
  }

  return data
}

/**
 * Bulk-insert multiple outreach entries in a single DB round-trip.
 * Used by the CSV uploader — avoids N sequential inserts (slow, fragile).
 * Returns the number of rows actually inserted.
 */
export async function logOutreachBatch(rows, currentPersonId) {
  if (!rows || rows.length === 0) return 0
  const today = istDateStr()
  const records = rows.map(r => ({
    ...r,
    logged_by: currentPersonId,
    outreach_date: r.outreach_date || today,
  }))

  // Attribution: link rows to existing leads before insert (one candidate
  // fetch + client-side match, instead of N lookups). Unmatched rows stay
  // orphans — we don't mass-create leads from a CSV of sent outreach.
  try {
    const { data: candidates } = await supabase
      .from('crm_leads')
      .select('id, name, firm_name, email, linkedin_url')
    if (candidates?.length) {
      const byLinkedIn = new Map()
      const byEmail = new Map()
      const byNameFirm = new Map()
      for (const l of candidates) {
        if (l.linkedin_url) byLinkedIn.set(normalizeLinkedInUrl(l.linkedin_url), l.id)
        if (l.email) byEmail.set(l.email.toLowerCase(), l.id)
        if (l.name) byNameFirm.set(`${l.name.toLowerCase()}|${(l.firm_name || '').toLowerCase()}`, l.id)
      }
      for (const r of records) {
        if (r.lead_id) continue
        if (r.linkedin_url && byLinkedIn.has(normalizeLinkedInUrl(r.linkedin_url))) {
          r.lead_id = byLinkedIn.get(normalizeLinkedInUrl(r.linkedin_url))
        } else if (r.lead_name && /@/.test(r.lead_name) && byEmail.has(r.lead_name.toLowerCase())) {
          r.lead_id = byEmail.get(r.lead_name.toLowerCase())
        } else if (r.lead_name && byNameFirm.has(`${r.lead_name.toLowerCase()}|${(r.firm_name || '').toLowerCase()}`)) {
          r.lead_id = byNameFirm.get(`${r.lead_name.toLowerCase()}|${(r.firm_name || '').toLowerCase()}`)
        }
      }
    }
  } catch (e) {
    console.error('logOutreachBatch: lead auto-link failed, importing unlinked', e)
  }

  const { data, error } = await supabase
    .from('crm_outreach_log')
    .insert(records)
    .select('*')
  if (error) throw error

  // Rows imported as already-replied flow into the pipeline like any other
  // reply. Sequential on purpose — each may create a lead and dedup checks
  // must see the previous row's creation.
  for (const row of data || []) {
    if (row.status === 'replied') {
      await syncReplyToPipeline(row, currentPersonId)
    }
  }

  return (data || []).length
}

/**
 * Update outreach entry. Marking an entry 'replied' pushes its person into
 * the pipeline: the linked lead advances to 'responded' (forward-only), or
 * an unlinked entry gets promoted into a lead at 'responded'. This is the
 * Tracker→Pipeline bridge — a reply anywhere shows up in the pipeline
 * without anyone re-entering the contact.
 */
export async function updateOutreach(id, updates, currentPersonId = null) {
  const { data, error } = await supabase
    .from('crm_outreach_log')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error

  if (updates.status === 'replied') {
    await syncReplyToPipeline(data, currentPersonId)
  }
  return data
}

/**
 * Reply→pipeline sync. Never throws — the reply status itself is already
 * saved; a sync failure shouldn't surface as "failed to update status".
 */
async function syncReplyToPipeline(outreachRow, currentPersonId = null) {
  try {
    const personId = currentPersonId ?? outreachRow.logged_by ?? null
    if (outreachRow.lead_id) {
      await advanceLeadStage(outreachRow.lead_id, 'responded', personId)
    } else if (outreachRow.lead_name) {
      await promoteOutreachToLead(outreachRow, personId, { stage: 'responded' })
    }
    cacheClear('leads')
    cacheClear('dashboard')
  } catch (e) {
    console.error('Reply→pipeline sync failed (status update itself succeeded):', e)
  }
}

/**
 * Turn an orphan outreach entry (no lead_id, just lead_name/firm_name) into a
 * real CRM lead so it can be viewed and edited in LeadDetail. Backfills the
 * outreach row's lead_id so future renders link straight through.
 */
export async function promoteOutreachToLead(outreach, currentPersonId, { stage = 'new_lead' } = {}) {
  if (!outreach?.lead_name) throw new Error('Outreach entry has no lead_name to promote')

  const name = String(outreach.lead_name).trim()
  const leadData = {
    name,
    firm_name: outreach.firm_name || null,
    lead_source: outreach.lead_source || null,
    stage
  }
  if (outreach.linkedin_url) leadData.linkedin_url = outreach.linkedin_url

  // If the name field actually holds an email (common for CSV-imported rows),
  // capture the email and fall back to the local-part as a readable name.
  if (/@/.test(name) && /\./.test(name.split('@')[1] || '')) {
    leadData.email = name
    const local = name.split('@')[0].replace(/[._-]+/g, ' ').trim()
    if (local) leadData.name = local.replace(/\b\w/g, c => c.toUpperCase())
  }

  // Roll optional context fields into deal_criteria so they aren't lost.
  const criteriaParts = []
  if (outreach.industry) criteriaParts.push(outreach.industry)
  if (outreach.deal_size) criteriaParts.push(outreach.deal_size)
  if (criteriaParts.length > 0) leadData.deal_criteria = criteriaParts.join(', ')

  // Dedup: prefer linking to an existing lead over creating a duplicate.
  let lead = null
  try {
    lead = await findLeadByEmailOrNameFirm({
      email: leadData.email,
      name: leadData.name,
      firm_name: leadData.firm_name
    })
  } catch (e) {
    console.error('promoteOutreachToLead: dedup lookup failed, falling through to create', e)
  }
  if (!lead) {
    lead = await createLead(leadData, currentPersonId)
  } else if (stage !== 'new_lead') {
    // Reply-driven promotion that matched an existing lead: pull that lead
    // forward to the requested stage (forward-only; never regresses).
    try {
      lead = await advanceLeadStage(lead.id, stage, currentPersonId) || lead
    } catch (e) {
      console.error('promoteOutreachToLead: failed to advance existing lead', e)
    }
  }

  try {
    await updateOutreach(outreach.id, { lead_id: lead.id })
  } catch (e) {
    console.error('promoteOutreachToLead: failed to backfill lead_id', e)
  }

  return lead
}

/**
 * Delete outreach entry
 */
export async function deleteOutreach(id) {
  const { error } = await supabase
    .from('crm_outreach_log')
    .delete()
    .eq('id', id)

  if (error) throw error
}


/**
 * Per-person dashboard stats for the Outreach Tracker header. Legacy RPCs
 * (get_todays_outreach_count / get_outreach_streak / get_daily_outreach_stats)
 * are team-wide, so every user saw the same numbers — this replaces them
 * with a single per-person query that computes the same three shapes
 * client-side.
 */
export async function getPersonDashboardStats(personId, { daysBack = 30, dailyGoal = 10, weekDays = 7 } = {}) {
  if (!personId) return { todayCount: 0, streak: 0, dailyStats: [] }

  const { data, error } = await supabase
    .from('crm_outreach_log')
    .select('outreach_date')
    .eq('logged_by', personId)
    .gte('outreach_date', istAddDays(istDateStr(), -daysBack))
  if (error) throw error

  const today = istDateStr()
  const byDate = new Map()
  for (const r of data || []) {
    byDate.set(r.outreach_date, (byDate.get(r.outreach_date) || 0) + 1)
  }

  const todayCount = byDate.get(today) || 0

  // Streak: consecutive days hitting the goal. Include today if hit;
  // otherwise start from yesterday so a mid-day lull doesn't reset it.
  let streak = 0
  let cursor = todayCount >= dailyGoal ? today : istAddDays(today, -1)
  while ((byDate.get(cursor) || 0) >= dailyGoal) {
    streak += 1
    cursor = istAddDays(cursor, -1)
  }

  const dailyStats = []
  for (let i = 0; i < weekDays; i += 1) {
    const date = istAddDays(today, -i)
    const count = byDate.get(date) || 0
    dailyStats.push({ date, total_outreaches: count, goal_met: count >= dailyGoal })
  }

  return { todayCount, streak, dailyStats }
}


// ============================================================================
// LEAD ASSIGNMENT
// ============================================================================

/**
 * Assign lead to a person
 */
export async function assignLead(leadId, assignedToPersonId, assignedByPersonId) {
  const updateData = {
    assigned_to: assignedToPersonId,
    assigned_by: assignedToPersonId ? assignedByPersonId : null,
    assigned_date: assignedToPersonId ? new Date().toISOString() : null
  }

  const { data, error } = await supabase
    .from('crm_leads')
    .update(updateData)
    .eq('id', leadId)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Get leads assigned to a person
 */
export async function getAssignedLeads(personId) {
  const { data, error } = await supabase
    .from('crm_leads')
    .select('*')
    .eq('assigned_to', personId)
    .order('assigned_date', { ascending: false })

  if (error) throw error
  return data || []
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
// OUTREACH ADMIN (all entries, no lead filter)
// ============================================================================

/**
 * Get all outreach log entries across every lead, with optional filters.
 * filters: { platform, days_back, has_response }
 */
export async function getAllOutreachLogs(filters = {}) {
  let query = supabase
    .from('crm_outreach_log')
    .select(`
      *,
      lead:crm_leads(id, name, firm_name, stage, outreach_stage),
      logged_by_person:logged_by(id, name)
    `)
    .order('outreach_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (filters.platform) {
    query = query.eq('outreach_type', filters.platform)
  }

  if (filters.has_response === true) {
    query = query.eq('status', 'replied')
  } else if (filters.has_response === false) {
    query = query.neq('status', 'replied')
  }

  if (filters.days_back) {
    query = query.gte('outreach_date', istAddDays(istDateStr(), -filters.days_back))
  }

  if (filters.logged_by) query = query.eq('logged_by', filters.logged_by)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

/**
 * Lightweight per-person daily outreach records for the last N days.
 * Used to compute today/streak/weekly/best-day dashboards without
 * loading the full outreach rows. Returns: [{logged_by, outreach_date, status}]
 */
// All-time outreach count for a person — drives the career milestone badge
// on the Dashboard. head:true so no rows cross the wire.
export async function getCareerOutreachCount(personId) {
  if (!personId) return 0
  const { count, error } = await supabase
    .from('crm_outreach_log')
    .select('id', { count: 'exact', head: true })
    .eq('logged_by', personId)
  if (error) throw error
  return count || 0
}

/**
 * Weekly funnel for the admin Dashboard: per IST week (Mon-Sun), how much
 * outreach went out, how many replies came back, how many meetings were
 * logged (crm_lead_activities call/meeting), and how many PE OS demos
 * happened (crm_demos by demo_date; signups = demos at stage signed_up).
 * personId null = team-wide (RLS lets admins through).
 * Returns weeks oldest → newest: [{ weekStart, outreach, replies, meetings, demos, signups }]
 */
export async function getWeeklyFunnel(weeksBack = 8, personId = null) {
  const thisWeekStart = istWeekStart(istDateStr())
  const rangeStart = istAddDays(thisWeekStart, -7 * (weeksBack - 1))

  let outreachQ = supabase
    .from('crm_outreach_log')
    .select('outreach_date, status')
    .gte('outreach_date', rangeStart)
  if (personId) outreachQ = outreachQ.eq('logged_by', personId)

  let meetingsQ = supabase
    .from('crm_lead_activities')
    .select('activity_date, activity_type')
    .in('activity_type', ['call', 'meeting'])
    .gte('activity_date', rangeStart)
  if (personId) meetingsQ = meetingsQ.eq('logged_by', personId)

  let demosQ = supabase
    .from('crm_demos')
    .select('demo_date, stage')
    .not('demo_date', 'is', null)
    .gte('demo_date', rangeStart)
  if (personId) demosQ = demosQ.eq('created_by', personId)

  const [outreach, meetings, demos] = await Promise.all([outreachQ, meetingsQ, demosQ])
  for (const res of [outreach, meetings, demos]) {
    if (res.error) throw res.error
  }

  // Seed every week in range so quiet weeks still render as zeros.
  const weeks = new Map()
  for (let i = 0; i < weeksBack; i += 1) {
    const ws = istAddDays(thisWeekStart, -7 * (weeksBack - 1 - i))
    weeks.set(ws, { weekStart: ws, outreach: 0, replies: 0, meetings: 0, demos: 0, signups: 0 })
  }
  const bucket = (dateStr) => weeks.get(istWeekStart(String(dateStr).slice(0, 10)))

  for (const r of outreach.data || []) {
    const w = bucket(r.outreach_date)
    if (!w) continue
    w.outreach += 1
    if (r.status === 'replied') w.replies += 1
  }
  for (const r of meetings.data || []) {
    const w = bucket(r.activity_date)
    if (w) w.meetings += 1
  }
  for (const r of demos.data || []) {
    const w = bucket(r.demo_date)
    if (!w) continue
    w.demos += 1
    if (r.stage === 'signed_up') w.signups += 1
  }

  return [...weeks.values()]
}

export async function getOutreachStatsByPerson(daysBack = 90, personId = null) {
  let q = supabase
    .from('crm_outreach_log')
    .select('logged_by, outreach_date, status, outreach_type, lead_source')
    .gte('outreach_date', istAddDays(istDateStr(), -daysBack))
  if (personId) q = q.eq('logged_by', personId)

  const { data, error } = await q

  if (error) throw error
  return data || []
}

/**
 * Raw material for Analytics' speed/follow-through metrics: leads created in
 * the window plus every lead-linked outreach touch. Aggregation happens
 * client-side so the page can re-slice by person/window without refetching.
 */
export async function getLeadTouchData(daysBack = 90) {
  const since = istAddDays(istDateStr(), -daysBack)
  const [leadsRes, touchesRes] = await Promise.all([
    supabase
      .from('crm_leads')
      .select('id, created_at, created_by, assigned_to')
      .gte('created_at', since),
    supabase
      .from('crm_outreach_log')
      .select('lead_id, outreach_date')
      .not('lead_id', 'is', null)
  ])
  if (leadsRes.error) throw leadsRes.error
  if (touchesRes.error) throw touchesRes.error
  return { leads: leadsRes.data || [], touches: touchesRes.data || [] }
}

// ============================================================================
// OUTREACH ANALYSIS
// ============================================================================

// Send outreach entries (must include message_content + status) to the
// serverless AI analysis function. Returns { summary, observations,
// avg_words_replied, avg_words_not_replied, low_data, total_analyzed,
// replied_count, analyzed_at }.
export async function analyzeOutreach(entries) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')
  const response = await fetch('/api/analyze-outreach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ entries })
  })
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error(result.error || 'Analysis failed')
  return result.analysis
}

// Map<lead_id, latest_outreach_status> for every lead with any outreach
// entry. Used by the Sales Pipeline's response-status filter so leads
// can be sliced by 'replied' / 'no_response' / 'bounced' without the
// page loading the full outreach log.
//
// "Latest" is by outreach_date descending — replies override an earlier
// 'sent' on the same lead, which is the behavior we want.
// ============================================================================
// LEAD HISTORY (person-hub cards on LeadDetail)
// ============================================================================
// The Goals page (crm_goals / crm_goal_progress) was removed July 2026 —
// outreach targets are now per-user columns on people, set from Admin.

/** All outreach entries linked to a lead, newest first. */
export async function getOutreachForLead(leadId) {
  const { data, error } = await supabase
    .from('crm_outreach_log')
    .select('*, logged_by_person:logged_by(id, name)')
    .eq('lead_id', leadId)
    .order('outreach_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/** All PE OS demos linked to a lead, newest first. */
export async function getDemosForLead(leadId) {
  const { data, error } = await supabase
    .from('crm_demos')
    .select('*')
    .eq('lead_id', leadId)
    .order('demo_date', { ascending: false, nullsFirst: false })
  if (error) throw error
  return data || []
}

// ============================================================================
// OUTREACH QUEUE API
// ============================================================================

// Bulk-create leads from a list of LinkedIn URLs. Dedupes against existing
// leads (by normalized URL) and within the input itself. All new rows share
// the same import_batch_id so the queue UI can group them. assigneeIds is
// an optional array of person ids — leads round-robin across them; falls
// back to the uploader when omitted.
export async function bulkCreateLeads(urls, batchLabel, currentPersonId, assigneeIds = null) {
  const cleaned = (urls || [])
    .map(u => (u || '').trim())
    .filter(u => u && normalizeLinkedInUrl(u))
  if (cleaned.length === 0) {
    return { added: 0, skipped: 0, batchId: null, batchLabel: null, leads: [] }
  }

  const seen = new Set()
  const uniqueUrls = []
  for (const url of cleaned) {
    const norm = normalizeLinkedInUrl(url)
    if (seen.has(norm)) continue
    seen.add(norm)
    uniqueUrls.push(url)
  }

  const { data: existing, error: existingError } = await supabase
    .from('crm_leads')
    .select('linkedin_url')
    .not('linkedin_url', 'is', null)
  if (existingError) throw existingError
  const existingNormalized = new Set(
    (existing || []).map(l => normalizeLinkedInUrl(l.linkedin_url)).filter(Boolean)
  )

  const toInsert = uniqueUrls.filter(url => !existingNormalized.has(normalizeLinkedInUrl(url)))
  const skipped = cleaned.length - toInsert.length

  if (toInsert.length === 0) {
    return { added: 0, skipped, batchId: null, batchLabel: null, leads: [] }
  }

  const batchId = crypto.randomUUID()
  const label = (batchLabel || '').trim() || null
  const now = new Date().toISOString()

  const validAssignees = (assigneeIds || []).filter(Boolean)
  const pool = validAssignees.length > 0 ? validAssignees : [currentPersonId]

  const rows = toInsert.map((url, i) => ({
    name: nameFromLinkedInUrl(url) || 'Unknown',
    linkedin_url: url,
    stage: 'new_lead',
    lead_source: 'Bulk Import',
    created_by: currentPersonId,
    assigned_to: pool[i % pool.length],
    last_activity_date: now,
    last_activity_type: 'created',
    import_batch_id: batchId,
    import_batch_label: label
  }))

  const { data, error } = await supabase
    .from('crm_leads')
    .insert(rows)
    .select()
  if (error) throw error

  cacheClear('leads')
  cacheClear('dashboard')

  return { added: data.length, skipped, batchId, batchLabel: label, leads: data }
}

export async function getOutreachQueue(currentPersonId) {
  if (!currentPersonId) return { leads: [], batchStats: {} }
  const { data: queue, error } = await supabase
    .from('crm_leads')
    .select('*')
    .eq('assigned_to', currentPersonId)
    .eq('stage', 'new_lead')
    .order('created_at', { ascending: false })
  if (error) throw error

  const batchIds = [...new Set((queue || []).map(l => l.import_batch_id).filter(Boolean))]
  const batchStats = {}
  if (batchIds.length > 0) {
    const { data: batchLeads, error: statsError } = await supabase
      .from('crm_leads')
      .select('import_batch_id, stage')
      .eq('assigned_to', currentPersonId)
      .in('import_batch_id', batchIds)
    if (statsError) throw statsError
    for (const row of batchLeads || []) {
      const id = row.import_batch_id
      if (!batchStats[id]) batchStats[id] = { total: 0, contacted: 0 }
      batchStats[id].total += 1
      if (row.stage !== 'new_lead') batchStats[id].contacted += 1
    }
  }
  return { leads: queue || [], batchStats }
}

// Mark a queued lead as reached out: logs a LinkedIn outreach entry and
// transitions the lead to 'cold_outreach' so it drops out of the queue.
export async function markLeadReachedOut(lead, currentPersonId, currentPersonName) {
  await logOutreach({
    lead_id: lead.id,
    lead_name: lead.name,
    firm_name: lead.firm_name || '',
    outreach_type: 'linkedin_message',
    status: 'sent',
    platform_details: lead.linkedin_url || ''
  }, currentPersonId, currentPersonName)

  const { data, error } = await supabase
    .from('crm_leads')
    .update({
      stage: 'cold_outreach',
      last_activity_date: new Date().toISOString(),
      last_activity_type: 'outreach'
    })
    .eq('id', lead.id)
    .select()
    .single()
  if (error) throw error

  cacheClear('leads')
  cacheClear('dashboard')
  return data
}

// ============================================================================
// PE OS DEMOS
// ============================================================================
// Restored after a cleanup commit briefly dropped them. The PE OS page and
// the Sales Pipeline's "PE OS" filter pill both depend on these.

// Fetch demos with the linked lead's basic fields embedded (so kanban cards
// can show name + firm without a follow-up query) and the creator's basic
// person row (so admin team views can show 'by Gaurav' on each card).
// When personId is provided, scopes to that person's demos; admins pass
// null to see everything RLS permits.
export async function getDemos(personId = null) {
  let q = supabase
    .from('crm_demos')
    .select(`
      *,
      lead:crm_leads(id, name, firm_name, email, linkedin_url, stage),
      created_by_person:created_by(id, name, email)
    `)
    .order('updated_at', { ascending: false })
  if (personId) q = q.eq('created_by', personId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createDemo(demoData, currentPersonId) {
  const { data, error } = await supabase
    .from('crm_demos')
    .insert([{ ...demoData, created_by: currentPersonId }])
    .select(`
      *,
      lead:crm_leads(id, name, firm_name, email, linkedin_url, stage),
      created_by_person:created_by(id, name, email)
    `)
    .single()
  if (error) throw error
  return data
}

export async function updateDemo(id, updates) {
  const cleanUpdates = {}
  Object.keys(updates).forEach(key => {
    if (['id', 'created_at', 'updated_at', 'created_by', 'lead', 'created_by_person'].includes(key)) return
    if (updates[key] !== undefined) cleanUpdates[key] = updates[key]
  })
  const { data, error } = await supabase
    .from('crm_demos')
    .update(cleanUpdates)
    .eq('id', id)
    .select(`
      *,
      lead:crm_leads(id, name, firm_name, email, linkedin_url, stage),
      created_by_person:created_by(id, name, email)
    `)
    .single()
  if (error) throw error
  return data
}

export async function moveDemo(id, stage) {
  const { data, error } = await supabase
    .from('crm_demos')
    .update({ stage })
    .eq('id', id)
    .select(`
      *,
      lead:crm_leads(id, name, firm_name, email, linkedin_url, stage),
      created_by_person:created_by(id, name, email)
    `)
    .single()
  if (error) throw error
  return data
}

export async function deleteDemo(id) {
  const { error } = await supabase
    .from('crm_demos')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// Distinct lead_ids that appear in crm_demos. Feeds the Sales Pipeline's
// "PE OS" filter pill so leads with at least one demo can be surfaced
// without loading the full demo rows.
export async function getDemoLeadIds(personId = null) {
  let q = supabase.from('crm_demos').select('lead_id')
  if (personId) q = q.eq('created_by', personId)
  const { data, error } = await q
  if (error) throw error
  return new Set((data || []).map(r => r.lead_id).filter(Boolean))
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

export async function getLeadLatestOutreachStatus(personId = null) {
  let q = supabase
    .from('crm_outreach_log')
    .select('lead_id, status, outreach_date')
    .not('lead_id', 'is', null)
    .order('outreach_date', { ascending: false })
  if (personId) q = q.eq('logged_by', personId)
  const { data, error } = await q
  if (error) throw error
  const map = new Map()
  for (const row of data || []) {
    // First row per lead_id wins because we ordered desc.
    if (!map.has(row.lead_id)) map.set(row.lead_id, row.status || 'sent')
  }
  return map
}

// ============================================================================
// TODAY TAB API
// ============================================================================
// Per-user daily work queue (src/pages/Today.jsx). Every fetch is scoped to
// the current person via assigned_to (RLS applies on top as the signed-in
// user); admins pass null where noted to see everything. Staleness
// thresholds come from crm_settings with 3/7/14 fallbacks.

// Ranking weights: warm/responded leads outrank active conversations going
// quiet, then cold-outreach continuations, then new leads. Stages absent
// here (client, passed, reach_out_later) never enter the queue.
export const TODAY_STAGE_WEIGHTS = {
  warm_lead: 5,
  responded: 5,
  active_conversation: 4,
  meeting_booked: 3,
  cold_outreach: 2,
  new_lead: 1
}

const TODAY_QUEUE_STAGES = Object.keys(TODAY_STAGE_WEIGHTS)
const TODAY_ENGAGED_STAGES = ['responded', 'warm_lead', 'active_conversation', 'meeting_booked']

/**
 * Staleness thresholds for the Today tab. Reads crm_settings (the same
 * source calculateStaleness uses) and falls back to 3/7/14 if the settings
 * row is unreachable, so the tab still ranks sensibly.
 * Returns { cold, warm, active, raw } — raw is a settings-shaped object
 * safe to hand to StalenessBadge/calculateStaleness.
 */
export async function getTodayThresholds() {
  try {
    const s = await getCRMSettings()
    return {
      cold: s.cold_outreach_threshold || 3,
      warm: s.warm_lead_threshold || 7,
      active: s.active_conversation_threshold || 14,
      raw: s
    }
  } catch (e) {
    console.error('getTodayThresholds: settings unavailable, using 3/7/14 fallback', e)
    const raw = { cold_outreach_threshold: 3, warm_lead_threshold: 7, active_conversation_threshold: 14 }
    return { cold: 3, warm: 7, active: 14, raw }
  }
}

/** Days since the lead's last activity (creation date if never touched). */
export function daysStaleFor(lead) {
  const ref = lead.last_activity_date || lead.created_at
  if (!ref) return 0
  return getDaysBetween(new Date(ref), new Date())
}

/**
 * Today-queue rank: stage weight × days-stale × lead_score.
 * days-stale and lead_score floor at 1 so a missing score or same-day
 * activity never zeroes out an otherwise urgent lead.
 */
export function todayRank(lead) {
  const weight = TODAY_STAGE_WEIGHTS[lead.stage] || 0
  return weight * Math.max(daysStaleFor(lead), 1) * Math.max(lead.lead_score || 0, 1)
}

/**
 * Today's touches: the current user's assigned leads, ranked by todayRank,
 * capped at `limit` (25 — finishable, not a wall). Leads already touched
 * today (on any surface) are excluded, which is also what makes
 * "pull 25 more" a simple refetch. Returns { leads, total } where total is
 * the full untouched pool size for the header counter.
 */
export async function getTodayQueue(personId, { limit = 25 } = {}) {
  if (!personId) return { leads: [], total: 0 }
  const today = istDateStr()

  const { data, error } = await supabase
    .from('crm_leads')
    .select('*')
    .eq('assigned_to', personId)
    .in('stage', TODAY_QUEUE_STAGES)
  if (error) throw error

  const candidates = (data || []).filter(lead => {
    // Touched today already (any surface) — done, not due.
    if (lead.last_activity_date && istDateStr(new Date(lead.last_activity_date).getTime()) === today) return false
    return true
  })

  candidates.sort((a, b) => {
    const diff = todayRank(b) - todayRank(a)
    if (diff !== 0) return diff
    // Ties (mostly unscored new leads): newest first.
    return (b.created_at || '').localeCompare(a.created_at || '')
  })

  return { leads: candidates.slice(0, limit), total: candidates.length }
}

/**
 * One-tap "✓ Touched": logs a note activity (which also stamps
 * last_activity_date via logActivity) so the lead drops out of the queue
 * and the touch shows up in every activity-driven metric.
 */
export async function markLeadTouched(lead, currentPersonId, note = '') {
  const trimmed = (note || '').trim()
  return logActivity(lead.id, {
    activity_type: 'note',
    notes: trimmed ? `Touched — ${trimmed}` : 'Touched (Today tab)'
  }, currentPersonId)
}

/**
 * Follow-ups due: assigned engaged leads (responded/warm/active/meeting)
 * hitting the day-3/7/14 cadence marks (thresholds from settings), or with
 * next_follow_up_date ≤ today. Sorted most-stale first.
 */
export async function getFollowUpsDue(personId) {
  if (!personId) return []
  const t = await getTodayThresholds()
  const today = istDateStr()

  const { data, error } = await supabase
    .from('crm_leads')
    .select('*')
    .eq('assigned_to', personId)
    .in('stage', TODAY_ENGAGED_STAGES)
  if (error) throw error

  const marks = new Set([t.cold, t.warm, t.active])
  return (data || [])
    .filter(lead => {
      if (lead.next_follow_up_date && lead.next_follow_up_date <= today) return true
      return marks.has(daysStaleFor(lead))
    })
    .sort((a, b) => daysStaleFor(b) - daysStaleFor(a))
}

/**
 * Escalations to Dev — high bar, capped at 10:
 * - active_conversation silent past the active threshold (>14d), or
 * - budget discussed / expected close date set on an engaged lead that's
 *   stalling past the warm threshold.
 * personId scopes to one owner's book; null aggregates across all users
 * (Dev/admin view — RLS lets admins through).
 */
export async function getEscalations(personId = null, { limit = 10 } = {}) {
  const t = await getTodayThresholds()

  let q = supabase
    .from('crm_leads')
    .select('*')
    .not('stage', 'in', '(passed,client)')
  if (personId) q = q.eq('assigned_to', personId)
  const { data, error } = await q
  if (error) throw error

  const escalations = (data || []).filter(lead => {
    const days = daysStaleFor(lead)
    if (lead.stage === 'active_conversation' && days > t.active) return true
    const dealSignals = lead.budget_discussed || lead.expected_close_date
    if (dealSignals && days > t.warm && TODAY_ENGAGED_STAGES.includes(lead.stage)) return true
    return false
  })

  escalations.sort((a, b) => daysStaleFor(b) - daysStaleFor(a))
  return escalations.slice(0, limit)
}

/**
 * "Ping Dev": logs an escalation note on the lead so Dev sees it in the
 * activity feed and the lead's history carries the escalation trail.
 */
export async function pingDevOnLead(lead, currentPersonId, currentPersonName) {
  const stageLabel = (lead.stage || '').replace(/_/g, ' ')
  return logActivity(lead.id, {
    activity_type: 'note',
    notes: `⚠️ Escalated to Dev by ${currentPersonName || 'team'} (Today tab) — ${daysStaleFor(lead)}d silent in ${stageLabel}`
  }, currentPersonId)
}

/** Unassigned, still-workable leads (id + name only — feeds the banner). */
export async function getUnassignedLeads() {
  const { data, error } = await supabase
    .from('crm_leads')
    .select('id, name, stage')
    .is('assigned_to', null)
    .not('stage', 'in', '(passed,client)')
  if (error) throw error
  return data || []
}

/**
 * Bulk self-assign: claim every lead in leadIds for personId. Chunked so a
 * large unassigned pool doesn't blow the request URL limit. Returns the
 * number of leads actually claimed.
 */
export async function bulkClaimLeads(leadIds, personId) {
  if (!leadIds?.length || !personId) return 0
  const now = new Date().toISOString()
  let claimed = 0
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200)
    const { data, error } = await supabase
      .from('crm_leads')
      .update({ assigned_to: personId, assigned_by: personId, assigned_date: now })
      .in('id', chunk)
      .select('id')
    if (error) throw error
    claimed += (data || []).length
  }
  cacheClear('leads')
  cacheClear('dashboard')
  return claimed
}

/**
 * Header-strip extras that need their own queries:
 * - overdueSLA: assigned leads past their staleness threshold (red), plus
 *   new leads past the first-touch SLA (creation + cold threshold days).
 * - touchesThisWeek / touchesLastWeek: activities logged by this person,
 *   bucketed by IST week — the one counter with a computable week-over-week
 *   delta (queue sizes have no historical snapshots).
 */
export async function getTodayCounters(personId) {
  if (!personId) return { overdueSLA: 0, touchesThisWeek: 0, touchesLastWeek: 0 }
  const t = await getTodayThresholds()
  const thisWeekStart = istWeekStart(istDateStr())
  const lastWeekStart = istAddDays(thisWeekStart, -7)
  const activityFrom = new Date(lastWeekStart + 'T00:00:00+05:30').toISOString()

  const leadsQ = supabase
    .from('crm_leads')
    .select('id, stage, created_at, last_activity_date')
    .eq('assigned_to', personId)
    .not('stage', 'in', '(passed,client)')

  const touchesQ = supabase
    .from('crm_lead_activities')
    .select('activity_date')
    .eq('logged_by', personId)
    .gte('activity_date', activityFrom)

  const [leadsRes, touchesRes] = await Promise.all([leadsQ, touchesQ])
  if (leadsRes.error) throw leadsRes.error
  if (touchesRes.error) throw touchesRes.error

  let overdueSLA = 0
  for (const lead of leadsRes.data || []) {
    if (lead.stage === 'new_lead') {
      // First-touch SLA runs from creation, not last activity.
      if (getDaysBetween(new Date(lead.created_at), new Date()) > t.cold) overdueSLA += 1
      continue
    }
    if (calculateStaleness(lead, t.raw).status === 'stale') overdueSLA += 1
  }

  let touchesThisWeek = 0
  let touchesLastWeek = 0
  for (const a of touchesRes.data || []) {
    const week = istWeekStart(istDateStr(new Date(a.activity_date).getTime()))
    if (week === thisWeekStart) touchesThisWeek += 1
    else if (week === lastWeekStart) touchesLastWeek += 1
  }

  return { overdueSLA, touchesThisWeek, touchesLastWeek }
}

/**
 * Admin rollup: touches logged this IST week per person, most active first.
 * Team accountability at a glance above the sections.
 */
export async function getTeamTouchesThisWeek() {
  const from = new Date(istWeekStart(istDateStr()) + 'T00:00:00+05:30').toISOString()
  const { data, error } = await supabase
    .from('crm_lead_activities')
    .select('logged_by, logged_by_person:logged_by(id, name)')
    .gte('activity_date', from)
  if (error) throw error

  const byPerson = new Map()
  for (const row of data || []) {
    if (!row.logged_by) continue
    const cur = byPerson.get(row.logged_by) || {
      personId: row.logged_by,
      name: row.logged_by_person?.name || `#${row.logged_by}`,
      count: 0
    }
    cur.count += 1
    byPerson.set(row.logged_by, cur)
  }
  return [...byPerson.values()].sort((a, b) => b.count - a.count)
}
