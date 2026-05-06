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
  const { data, error } = await supabase
    .from('crm_leads')
    .insert([{
      ...leadData,
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
export async function updateLead(id, updates) {
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

/**
 * Delete activity
 */
export async function deleteActivity(id) {
  const { error } = await supabase
    .from('crm_lead_activities')
    .delete()
    .eq('id', id)

  if (error) throw error
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
 * Get sample deal by ID
 */
export async function getSampleDealById(id) {
  const { data, error } = await supabase
    .from('crm_sample_deals')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
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

/**
 * Send sample deals to a lead
 */
export async function sendSampleDeals(leadId, sampleDealIds, currentPersonId) {
  // Log activity
  await logActivity(leadId, {
    activity_type: 'sample_sent',
    activity_date: new Date().toISOString(),
    notes: `Sent ${sampleDealIds.length} sample deals`,
    sample_deals_sent: sampleDealIds
  }, currentPersonId)

  // Clear needs_sample_deals flag
  await updateLead(leadId, {
    needs_sample_deals: false
  })

  // Return the deals that were sent
  const { data, error } = await supabase
    .from('crm_sample_deals')
    .select('*')
    .in('id', sampleDealIds)

  if (error) throw error
  return data || []
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

/**
 * Update CRM settings
 */
export async function updateCRMSettings(updates) {
  const { data, error } = await supabase
    .from('crm_settings')
    .update(updates)
    .eq('id', 1)
    .select()
    .single()

  if (error) throw error
  _settingsCache = data
  _settingsCacheTime = Date.now()
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
 * Get conversion funnel stats
 */
export async function getConversionFunnelStats() {
  const { data, error } = await supabase
    .from('crm_leads')
    .select('stage')

  if (error) throw error

  const stages = data.reduce((acc, lead) => {
    acc[lead.stage] = (acc[lead.stage] || 0) + 1
    return acc
  }, {})

  return {
    new_lead: stages.new_lead || 0,
    cold_outreach: stages.cold_outreach || 0,
    responded: stages.responded || 0,
    warm_lead: stages.warm_lead || 0,
    active_conversation: stages.active_conversation || 0,
    client: stages.client || 0
  }
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

/**
 * Get CRM heartbeat for Sage monitoring
 */
export async function getCRMHeartbeat() {
  const { data, error } = await supabase.rpc('get_crm_heartbeat')

  if (error) throw error
  return data
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

/**
 * Filter sample deals by lead criteria
 */
export function filterSampleDealsByLead(sampleDeals, lead) {
  if (!lead.deal_criteria && !lead.lead_type) return sampleDeals

  return sampleDeals.filter(deal => {
    let matches = false

    // Match by lead type
    if (lead.lead_type && deal.client_type === lead.lead_type) {
      matches = true
    }

    // Match by deal criteria keywords
    if (lead.deal_criteria) {
      const criteria = lead.deal_criteria.toLowerCase()
      const industry = deal.industry?.toLowerCase() || ''
      const description = deal.description?.toLowerCase() || ''

      if (industry && criteria.includes(industry)) {
        matches = true
      }
      if (description && criteria.split(',').some(term =>
        description.includes(term.trim())
      )) {
        matches = true
      }
    }

    return matches
  })
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

export default {
  // Leads
  getLeads,
  getLeadById,
  createLead,
  updateLead,
  moveLead,
  deleteLead,

  // Activities
  getLeadActivities,
  logActivity,
  deleteActivity,

  // Sample Deals
  getSampleDeals,
  getSampleDealById,
  createSampleDeal,
  updateSampleDeal,
  deleteSampleDeal,
  sendSampleDeals,

  // Settings
  getCRMSettings,
  updateCRMSettings,

  // Dashboard
  getStaleLeads,
  getFollowUpsDueToday,
  getLeadsNeedingSamples,
  getActiveConversationsGoneStale,
  getWeeklyCallCount,
  getPipelineStats,
  getWeeklyStats,
  getConversionFunnelStats,
  getCRMDashboardData,
  getCRMHeartbeat,

  // Investors
  getInvestors,
  getInvestorById,
  createInvestor,
  updateInvestor,
  deleteInvestor,
  getInvestorInteractions,
  logInvestorInteraction,
  deleteInvestorInteraction,

  // Utilities
  calculateStaleness,
  filterSampleDealsByLead
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

export async function getAnalytics(personId = null) {
  let query = supabase
    .from('crm_leads')
    .select('*')
    .order('created_at', { ascending: false })

  if (personId) query = query.or(`created_by.eq.${personId},assigned_to.eq.${personId}`)

  const { data: leads, error } = await query

  if (error) throw error

  // Conversion funnel
  const stages = {
    new_lead: leads.filter(l => l.stage === 'new_lead').length,
    cold_outreach: leads.filter(l => l.stage === 'cold_outreach').length,
    responded: leads.filter(l => l.stage === 'responded').length,
    warm_lead: leads.filter(l => l.stage === 'warm_lead').length,
    active_conversation: leads.filter(l => l.stage === 'active_conversation').length,
    client: leads.filter(l => l.stage === 'client').length
  }

  const totalTop = stages.new_lead + stages.cold_outreach
  const conversion = {
    ...stages,
    new_to_cold_rate: stages.new_lead > 0 ? Math.round((stages.cold_outreach / stages.new_lead) * 100) : 0,
    cold_to_responded_rate: stages.cold_outreach > 0 ? Math.round((stages.responded / stages.cold_outreach) * 100) : 0,
    responded_to_warm_rate: stages.responded > 0 ? Math.round((stages.warm_lead / stages.responded) * 100) : 0,
    warm_to_active_rate: stages.warm_lead > 0 ? Math.round((stages.active_conversation / stages.warm_lead) * 100) : 0,
    active_to_client_rate: stages.active_conversation > 0 ? Math.round((stages.client / stages.active_conversation) * 100) : 0,
    overall_rate: totalTop > 0 ? Math.round((stages.client / totalTop) * 100) : 0
  }

  // Pipeline velocity (avg days in each stage)
  function getAvgDaysInStage(stage) {
    const stageLeads = leads.filter(l => l.stage === stage && l.created_at)
    if (stageLeads.length === 0) return 0

    const avgMs = stageLeads.reduce((sum, lead) => {
      const days = (new Date() - new Date(lead.created_at)) / (1000 * 60 * 60 * 24)
      return sum + days
    }, 0) / stageLeads.length

    return Math.round(avgMs)
  }

  const velocity = {
    new_lead: getAvgDaysInStage('new_lead'),
    cold_outreach: getAvgDaysInStage('cold_outreach'),
    responded: getAvgDaysInStage('responded'),
    warm_lead: getAvgDaysInStage('warm_lead'),
    active_conversation: getAvgDaysInStage('active_conversation'),
    total: Math.round((getAvgDaysInStage('new_lead') + getAvgDaysInStage('cold_outreach') + getAvgDaysInStage('responded') + getAvgDaysInStage('warm_lead') + getAvgDaysInStage('active_conversation')))
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

  // Weekly trends (last 4 weeks)
  const weekly = []
  for (let i = 0; i < 4; i++) {
    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - (i + 1) * 7)
    const weekEnd = new Date()
    weekEnd.setDate(weekEnd.getDate() - i * 7)

    const weekLeads = leads.filter(l => {
      const created = new Date(l.created_at)
      return created >= weekStart && created < weekEnd
    })

    weekly.unshift({
      new_leads: weekLeads.length,
      moved_to_active: weekLeads.filter(l => l.stage === 'active_conversation' || l.stage === 'client').length,
      closed: weekLeads.filter(l => l.stage === 'client').length
    })
  }

  return { conversion, velocity, sources, weekly }
}

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

export async function updateTranscript(id, updates) {
  const { data, error } = await supabase
    .from('crm_transcripts')
    .update(updates)
    .eq('id', id)
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

export async function createTag(tagData) {
  const { data, error } = await supabase
    .from('crm_tags')
    .insert([tagData])
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteTag(id) {
  const { error } = await supabase
    .from('crm_tags')
    .delete()
    .eq('id', id)

  if (error) throw error
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

export async function recalculateAllLeadScores() {
  const leads = await getLeads()
  const results = await Promise.all(
    leads.map(lead => calculateLeadScore(lead.id))
  )
  return results
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

  const apiKey = import.meta.env.VITE_CRM_API_KEY || 'your-secret-api-key-here'

  try {
    const response = await fetch('/api/enrich-linkedin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
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
  const apiKey = import.meta.env.VITE_CRM_API_KEY
  const response = await fetch('/api/enrich-linkedin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
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

  return data
}

/**
 * Update outreach entry
 */
export async function updateOutreach(id, updates) {
  const { data, error } = await supabase
    .from('crm_outreach_log')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Turn an orphan outreach entry (no lead_id, just lead_name/firm_name) into a
 * real CRM lead so it can be viewed and edited in LeadDetail. Backfills the
 * outreach row's lead_id so future renders link straight through.
 */
export async function promoteOutreachToLead(outreach, currentPersonId) {
  if (!outreach?.lead_name) throw new Error('Outreach entry has no lead_name to promote')

  const name = String(outreach.lead_name).trim()
  const leadData = {
    name,
    firm_name: outreach.firm_name || null,
    lead_source: outreach.lead_source || null,
    stage: 'new_lead'
  }

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
  if (!lead) lead = await createLead(leadData, currentPersonId)

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
 * Get today's outreach count
 */
export async function getTodaysOutreachCount() {
  const { data, error } = await supabase.rpc('get_todays_outreach_count')

  if (error) throw error
  return data || 0
}

/**
 * Daily outreach statistics, scoped to a person when personId is provided.
 * Legacy RPC `get_daily_outreach_stats` was team-wide, so every user saw
 * everyone's numbers — this replaces it with a per-person client-side
 * aggregation.
 */
export async function getDailyOutreachStats(daysBack = 30, personId = null) {
  let q = supabase
    .from('crm_outreach_log')
    .select('outreach_date, status')
    .gte('outreach_date', istAddDays(istDateStr(), -daysBack))
  if (personId) q = q.eq('logged_by', personId)
  const { data, error } = await q
  if (error) throw error

  const byDate = new Map()
  for (const row of data || []) {
    if (!byDate.has(row.outreach_date)) {
      byDate.set(row.outreach_date, { outreach_date: row.outreach_date, total_outreaches: 0, replies: 0 })
    }
    const b = byDate.get(row.outreach_date)
    b.total_outreaches += 1
    if (row.status === 'replied') b.replies += 1
  }
  return Array.from(byDate.values()).sort((a, b) => a.outreach_date.localeCompare(b.outreach_date))
}

/**
 * Get outreach streak (consecutive days hitting 10+ goal)
 */
export async function getOutreachStreak() {
  const { data, error } = await supabase.rpc('get_outreach_streak')

  if (error) throw error
  return data || 0
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

/**
 * Get outreach summary for today
 */
export async function getTodaysOutreachSummary() {
  const today = istDateStr()
  const outreaches = await getOutreachLog({ outreach_date: today })

  const summary = {
    total: outreaches.length,
    cold_email: 0,
    linkedin_message: 0,
    phone_call: 0,
    other: 0,
    replied: 0,
    sent: 0,
    no_response: 0
  }

  outreaches.forEach(o => {
    summary[o.outreach_type] = (summary[o.outreach_type] || 0) + 1
    summary[o.status] = (summary[o.status] || 0) + 1
  })

  return summary
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

/**
 * Get unassigned leads
 */
export async function getUnassignedLeads() {
  const { data, error } = await supabase
    .from('crm_leads')
    .select('*')
    .is('assigned_to', null)
    .neq('stage', 'passed')
    .neq('stage', 'client')
    .order('created_at', { ascending: false })

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
 * Get activity for a specific user
 */
export async function getUserActivity(userId, limit = 15) {
  const { data, error } = await supabase.rpc('get_user_activity', {
    p_user_id: userId,
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
  const apiKey = import.meta.env.VITE_CRM_API_KEY || 'your-secret-api-key-here'

  const response = await fetch('/api/analyze-transcript', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
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
export async function getOutreachStatsByPerson(daysBack = 90, personId = null) {
  let q = supabase
    .from('crm_outreach_log')
    .select('logged_by, outreach_date, status, outreach_type')
    .gte('outreach_date', istAddDays(istDateStr(), -daysBack))
  if (personId) q = q.eq('logged_by', personId)

  const { data, error } = await q

  if (error) throw error
  return data || []
}

// ============================================================================
// GOALS SYSTEM
// Structured goals (text + target_count + frequency) with per-period progress.
// ============================================================================

function getWeekStartDate(date = new Date()) {
  return istWeekStart(istDateStr(date.getTime()))
}

/**
 * Period-start (YYYY-MM-DD) for a given frequency.
 * - daily:   today in IST
 * - weekly:  Monday of this IST week
 * - monthly: first day of this IST month
 */
export function getPeriodStart(frequency, date = new Date()) {
  const d = new Date(date)
  const istDate = istDateStr(d.getTime()) // always the IST calendar date
  if (frequency === 'daily') {
    return istDate
  }
  if (frequency === 'weekly') {
    return istWeekStart(istDate)
  }
  if (frequency === 'monthly') {
    return istDate.slice(0, 7) + '-01' // YYYY-MM-01
  }
  throw new Error(`Unknown frequency: ${frequency}`)
}

/**
 * Fetch active goals for a person with current-period progress attached as
 * `current_count` and `period_start` on each goal.
 */
export async function getGoals(personId) {
  const { data: goals, error } = await supabase
    .from('crm_goals')
    .select('*')
    .eq('person_id', personId)
    .eq('is_active', true)
    .order('goal_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error
  if (!goals || goals.length === 0) return []

  const goalIds = goals.map(g => g.id)
  const { data: progressRows, error: progError } = await supabase
    .from('crm_goal_progress')
    .select('*')
    .in('goal_id', goalIds)

  if (progError) throw progError

  return goals.map(goal => {
    const periodStart = getPeriodStart(goal.frequency)
    const row = progressRows?.find(p => p.goal_id === goal.id && p.period_start === periodStart)
    return {
      ...goal,
      current_count: row?.count || 0,
      period_start: periodStart
    }
  })
}

export async function createGoal(goalData) {
  const { data, error } = await supabase
    .from('crm_goals')
    .insert([goalData])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateGoal(id, updates) {
  const { data, error } = await supabase
    .from('crm_goals')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteGoal(id) {
  const { error } = await supabase
    .from('crm_goals')
    .delete()
    .eq('id', id)
  if (error) throw error
}

/**
 * Add `delta` (default +1) to the current period's progress row for a goal.
 * Creates the row if missing. Floors the count at 0. Returns the new count.
 */
export async function incrementGoalProgress(goalId, delta = 1) {
  const { data: goal, error: goalError } = await supabase
    .from('crm_goals')
    .select('frequency')
    .eq('id', goalId)
    .single()
  if (goalError) throw goalError

  const periodStart = getPeriodStart(goal.frequency)

  const { data: existing, error: selError } = await supabase
    .from('crm_goal_progress')
    .select('id, count')
    .eq('goal_id', goalId)
    .eq('period_start', periodStart)
    .maybeSingle()
  if (selError) throw selError

  if (existing) {
    const newCount = Math.max(0, existing.count + delta)
    const { data, error } = await supabase
      .from('crm_goal_progress')
      .update({ count: newCount })
      .eq('id', existing.id)
      .select()
      .single()
    if (error) throw error
    return data.count
  }

  const initialCount = Math.max(0, delta)
  const { data, error } = await supabase
    .from('crm_goal_progress')
    .insert([{ goal_id: goalId, period_start: periodStart, count: initialCount }])
    .select()
    .single()
  if (error) throw error
  return data.count
}

// ============================================================================
// OUTREACH QUEUE API
// ============================================================================

// Bulk-create leads from a list of LinkedIn URLs. Dedupes against existing
// leads (by normalized URL) and within the input itself. All new rows share
// the same import_batch_id so the queue UI can group them.
//
// `assigneeIds` is an optional array of person ids the leads should be
// assigned to (round-robin distribution). When omitted, the uploader keeps
// every lead in their own queue.
// Returns { added, skipped, batchId, batchLabel, leads }.
export async function bulkCreateLeads(urls, batchLabel, currentPersonId, assigneeIds = null) {
  const cleaned = (urls || [])
    .map(u => (u || '').trim())
    .filter(u => u && normalizeLinkedInUrl(u))

  if (cleaned.length === 0) {
    return { added: 0, skipped: 0, batchId: null, batchLabel: null, leads: [] }
  }

  // Dedupe within input
  const seen = new Set()
  const uniqueUrls = []
  for (const url of cleaned) {
    const norm = normalizeLinkedInUrl(url)
    if (seen.has(norm)) continue
    seen.add(norm)
    uniqueUrls.push(url)
  }

  // Dedupe against existing leads
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

  // Round-robin across assignees so a 30-row paste split between Aabhas and
  // Gaurav lands as 15 each. Falls back to the uploader if no assignees set.
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

// Fetch this user's outreach queue: leads they created still at stage='new_lead'.
// Also returns batchStats so the UI can show per-batch progress bars
// (counts include already-contacted leads from the same batch).
export async function getOutreachQueue(currentPersonId) {
  if (!currentPersonId) return { leads: [], batchStats: {} }
  const { data: queue, error } = await supabase
    .from('crm_leads')
    .select('*')
    .eq('assigned_to', currentPersonId)
    .eq('stage', 'new_lead')
    .order('created_at', { ascending: false })
  if (error) throw error

  // Batch progress counts only this analyst's slice — if the same batch was
  // split between two people, each sees their own contacted/total.
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

// ============================================================================
// GENERIC FIELD OPTIONS (industry, deal_size, location, lead_source)
// ============================================================================

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

// Fetch demos with the linked lead's basic fields embedded (so the kanban
// cards can show name + firm without a follow-up query). When personId is
// provided, scopes to that person's demos; admins typically pass null.
export async function getDemos(personId = null) {
  let q = supabase
    .from('crm_demos')
    .select(`
      *,
      lead:crm_leads(id, name, firm_name, email, linkedin_url, stage)
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
      lead:crm_leads(id, name, firm_name, email, linkedin_url, stage)
    `)
    .single()
  if (error) throw error
  return data
}

export async function updateDemo(id, updates) {
  const cleanUpdates = {}
  Object.keys(updates).forEach(key => {
    if (['id', 'created_at', 'updated_at', 'created_by', 'lead'].includes(key)) return
    if (updates[key] !== undefined) cleanUpdates[key] = updates[key]
  })
  const { data, error } = await supabase
    .from('crm_demos')
    .update(cleanUpdates)
    .eq('id', id)
    .select(`
      *,
      lead:crm_leads(id, name, firm_name, email, linkedin_url, stage)
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
      lead:crm_leads(id, name, firm_name, email, linkedin_url, stage)
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

// Lightweight projection used by the Sales Pipeline "PE OS" filter:
// returns the distinct lead_ids that appear in crm_demos so the page
// can highlight leads with at least one demo without loading the full
// demo rows.
export async function getDemoLeadIds(personId = null) {
  let q = supabase.from('crm_demos').select('lead_id')
  if (personId) q = q.eq('created_by', personId)
  const { data, error } = await q
  if (error) throw error
  return new Set((data || []).map(r => r.lead_id).filter(Boolean))
}

// Map<lead_id, latest_outreach_status> for every lead with any outreach
// entry. Used by the Sales Pipeline's response-status filter so leads
// can be sliced by 'replied' / 'no_response' / 'bounced' without the
// page loading the full outreach log.
//
// "Latest" is by outreach_date descending — replies override an earlier
// 'sent' on the same lead, which is the behavior we want.
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

