/**
 * CRM API — investors (crm_investors) and their interactions.
 */

import { supabase } from '../supabase'
import { cacheGet, cacheSet, cacheClear } from './core'

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

/** Bulk status change — used by the Investors table's multi-select bar. */
export async function bulkUpdateInvestorStatus(ids, status) {
  if (!ids?.length) return 0
  const { data, error } = await supabase
    .from('crm_investors')
    .update({ status })
    .in('id', ids)
    .select('id')

  if (error) throw error
  cacheClear('investors')
  return (data || []).length
}

/** Bulk delete — used by the Investors table's multi-select bar. */
export async function bulkDeleteInvestors(ids) {
  if (!ids?.length) return 0
  // .select() so the count is rows ACTUALLY deleted. Without it PostgREST
  // reports no error when zero rows match (already deleted, or blocked by
  // policy) and the UI would cheerfully toast "Deleted 5".
  const { data, error } = await supabase
    .from('crm_investors')
    .delete()
    .in('id', ids)
    .select('id')

  if (error) throw error
  cacheClear('investors')
  return (data || []).length
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
