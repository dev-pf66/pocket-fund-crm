/**
 * CRM API — Indian sellers (crm_sellers), the buyside acquisition pipeline.
 */

import { supabase } from '../supabase'

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
