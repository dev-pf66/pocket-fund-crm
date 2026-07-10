/**
 * CRM API — potential partners (crm_partners).
 */

import { supabase } from '../supabase'

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
