/**
 * CRM API - Sales lead management for Pocket Fund
 */

import { supabase } from './supabase'

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

// ============================================================================
// LEADS API
// ============================================================================

/**
 * Get all leads with optional filters
 */
export async function getLeads(filters = {}) {
  const cacheKey = 'leads:' + JSON.stringify(filters)
  const cached = cacheGet(cacheKey, 15000) // 15s TTL
  if (cached) return cached

  let query = supabase
    .from('crm_leads')
    .select('*')
    .order('updated_at', { ascending: false })

  if (filters.stage) query = query.eq('stage', filters.stage)
  if (filters.lead_type) query = query.eq('lead_type', filters.lead_type)
  if (filters.needs_sample_deals !== undefined) query = query.eq('needs_sample_deals', filters.needs_sample_deals)

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
  return data
}

/**
 * Move lead to new stage
 */
export async function moveLead(id, newStage, currentPersonId) {
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
export async function getStaleLeads() {
  const settings = await getCRMSettings()
  const leads = await getLeads()

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
export async function getFollowUpsDueToday() {
  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('crm_leads')
    .select('*')
    .or(`next_follow_up_date.eq.${today},reach_out_later_date.eq.${today}`)
    .neq('stage', 'passed')

  if (error) throw error
  return data || []
}

/**
 * Get leads needing sample deals
 */
export async function getLeadsNeedingSamples() {
  const { data, error } = await supabase
    .from('crm_leads')
    .select('*')
    .eq('needs_sample_deals', true)
    .neq('stage', 'passed')

  if (error) throw error
  return data || []
}

/**
 * Get active conversations gone stale (CRITICAL)
 */
export async function getActiveConversationsGoneStale() {
  const settings = await getCRMSettings()
  const leads = await getLeads({ stage: 'active_conversation' })

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
export async function getPipelineStats() {
  const leads = await getLeads()

  const stats = {
    new_lead: 0,
    cold_outreach: 0,
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
  stats.warm_pct = (stats.warm_lead / stats.total) * 100
  stats.active_pct = (stats.active_conversation / stats.total) * 100
  stats.client_pct = (stats.client / stats.total) * 100

  return stats
}

/**
 * Get weekly stats
 */
export async function getWeeklyStats() {
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)

  const [activities, leads] = await Promise.all([
    supabase
      .from('crm_lead_activities')
      .select('activity_type')
      .gte('activity_date', weekAgo.toISOString()),
    supabase
      .from('crm_leads')
      .select('stage, created_at, updated_at')
  ])

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
    warm_lead: stages.warm_lead || 0,
    active_conversation: stages.active_conversation || 0,
    client: stages.client || 0
  }
}

/**
 * Get complete CRM dashboard data
 */
export async function getCRMDashboardData() {
  const cached = cacheGet('dashboard', 15000)
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
    getLeads(),
    getStaleLeads(),
    getFollowUpsDueToday(),
    getLeadsNeedingSamples(),
    getActiveConversationsGoneStale(),
    getWeeklyStats(),
    getPipelineStats(),
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
  cacheSet('dashboard', result)
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

export async function getAnalytics() {
  // Get all leads
  const { data: leads, error } = await supabase
    .from('crm_leads')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error

  // Conversion funnel
  const stages = {
    new_lead: leads.filter(l => l.stage === 'new_lead').length,
    cold_outreach: leads.filter(l => l.stage === 'cold_outreach').length,
    warm_lead: leads.filter(l => l.stage === 'warm_lead').length,
    active_conversation: leads.filter(l => l.stage === 'active_conversation').length,
    client: leads.filter(l => l.stage === 'client').length
  }

  const totalTop = stages.new_lead + stages.cold_outreach
  const conversion = {
    ...stages,
    new_to_cold_rate: stages.new_lead > 0 ? Math.round((stages.cold_outreach / stages.new_lead) * 100) : 0,
    cold_to_warm_rate: stages.cold_outreach > 0 ? Math.round((stages.warm_lead / stages.cold_outreach) * 100) : 0,
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
    warm_lead: getAvgDaysInStage('warm_lead'),
    active_conversation: getAvgDaysInStage('active_conversation'),
    total: Math.round((getAvgDaysInStage('new_lead') + getAvgDaysInStage('cold_outreach') + getAvgDaysInStage('warm_lead') + getAvgDaysInStage('active_conversation')))
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

// ============================================================================
// OUTREACH TRACKER
// ============================================================================

/**
 * Get outreach log entries
 */
export async function getOutreachLog(filters = {}) {
  let query = supabase
    .from('crm_outreach_log')
    .select(`
      *,
      lead:crm_leads(id, name, firm_name, stage),
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
    const daysAgo = new Date()
    daysAgo.setDate(daysAgo.getDate() - filters.days_back)
    query = query.gte('outreach_date', daysAgo.toISOString().split('T')[0])
  }

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
      outreach_date: outreachData.outreach_date || new Date().toISOString().split('T')[0]
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
 * Get daily outreach statistics
 */
export async function getDailyOutreachStats(daysBack = 30) {
  const { data, error } = await supabase.rpc('get_daily_outreach_stats', {
    days_back: daysBack
  })

  if (error) throw error
  return data || []
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
 * Get outreach summary for today
 */
export async function getTodaysOutreachSummary() {
  const today = new Date().toISOString().split('T')[0]
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
      lead:crm_leads(id, name, firm_name, stage),
      logged_by_person:logged_by(id, name)
    `)
    .order('outreach_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (filters.platform) {
    query = query.eq('outreach_type', filters.platform)
  }

  if (filters.has_response === true) {
    query = query.not('response_received', 'is', null).neq('response_received', '')
  } else if (filters.has_response === false) {
    query = query.or('response_received.is.null,response_received.eq.')
  }

  if (filters.days_back) {
    const since = new Date()
    since.setDate(since.getDate() - filters.days_back)
    query = query.gte('outreach_date', since.toISOString().split('T')[0])
  }

  const { data, error } = await query
  if (error) throw error
  return data || []
}

// ============================================================================
// WEEKLY GOALS SYSTEM
// ============================================================================

/**
 * Get all goal templates (optionally filtered by person or role)
 */
export async function getGoalTemplates(filters = {}) {
  let query = supabase
    .from('crm_weekly_goal_templates')
    .select('*')
    .eq('is_active', true)
    .order('goal_order', { ascending: true })

  if (filters.person_id) {
    query = query.eq('person_id', filters.person_id)
  }

  if (filters.role) {
    query = query.eq('role', filters.role)
  }

  const { data, error } = await query
  if (error) throw error
  return data || []
}

/**
 * Create a goal template
 */
export async function createGoalTemplate(templateData) {
  const { data, error } = await supabase
    .from('crm_weekly_goal_templates')
    .insert([templateData])
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Update a goal template
 */
export async function updateGoalTemplate(id, updates) {
  const { data, error } = await supabase
    .from('crm_weekly_goal_templates')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Delete a goal template
 */
export async function deleteGoalTemplate(id) {
  const { error } = await supabase
    .from('crm_weekly_goal_templates')
    .delete()
    .eq('id', id)

  if (error) throw error
}

/**
 * Get weekly goals for a person and week
 * @param personId - ID of the person
 * @param weekStartDate - Monday of the week (YYYY-MM-DD format)
 */
export async function getWeeklyGoals(personId, weekStartDate) {
  const { data, error } = await supabase
    .from('crm_weekly_goals')
    .select('*')
    .eq('person_id', personId)
    .eq('week_start_date', weekStartDate)
    .order('goal_order', { ascending: true })

  if (error) throw error
  return data || []
}

/**
 * Create/Initialize weekly goals for a person from templates
 */
export async function initializeWeeklyGoals(personId, weekStartDate) {
  // Get templates for this person (or their role)
  const templates = await getGoalTemplates({ person_id: personId })

  if (templates.length === 0) {
    return []
  }

  // Create goals from templates
  const goals = templates.map(template => ({
    person_id: personId,
    week_start_date: weekStartDate,
    goal_text: template.goal_text,
    goal_order: template.goal_order,
    is_completed: false
  }))

  const { data, error } = await supabase
    .from('crm_weekly_goals')
    .upsert(goals, { 
      onConflict: 'person_id,week_start_date,goal_text',
      ignoreDuplicates: true 
    })
    .select()

  if (error) throw error
  return data || []
}

/**
 * Add a custom goal for the week
 */
export async function addWeeklyGoal(goalData) {
  const { data, error } = await supabase
    .from('crm_weekly_goals')
    .insert([goalData])
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Update a weekly goal (toggle completion, edit text, add notes)
 */
export async function updateWeeklyGoal(id, updates) {
  // If marking as completed, set completed_at
  if (updates.is_completed && !updates.completed_at) {
    updates.completed_at = new Date().toISOString()
  }

  // If marking as incomplete, clear completed_at
  if (updates.is_completed === false) {
    updates.completed_at = null
  }

  const { data, error } = await supabase
    .from('crm_weekly_goals')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Delete a weekly goal
 */
export async function deleteWeeklyGoal(id) {
  const { error } = await supabase
    .from('crm_weekly_goals')
    .delete()
    .eq('id', id)

  if (error) throw error
}

/**
 * Get Monday of current week (or any date)
 */
export function getWeekStartDate(date = new Date()) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // adjust when day is sunday
  const monday = new Date(d.setDate(diff))
  return monday.toISOString().split('T')[0]
}

/**
 * Get weekly goal stats for a person
 */
export async function getWeeklyGoalStats(personId, weekStartDate) {
  const goals = await getWeeklyGoals(personId, weekStartDate)
  
  const total = goals.length
  const completed = goals.filter(g => g.is_completed).length
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

  return {
    total,
    completed,
    remaining: total - completed,
    percentage
  }
}
