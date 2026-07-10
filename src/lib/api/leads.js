/**
 * CRM API — leads: CRUD, forward-only stage machinery, activities,
 * stale/follow-up/pipeline queries, staleness calc, assignment, and the
 * dashboard aggregate.
 */

import { supabase } from '../supabase'
import { normalizeLinkedInUrl } from '../linkedin'
import { cacheGet, cacheSet, cacheClear, fireTTEvent, istDateStr, getDaysBetween } from './core'
import { getCRMSettings } from './misc'

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
