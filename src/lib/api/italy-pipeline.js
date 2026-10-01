/**
 * CRM API — Italy pipeline (crm_italy_pipeline), the mixed-ecosystem buyside
 * pipeline (sellers, buyers, brokers, other contacts).
 */

import { supabase } from '../supabase'

// ============================================================================
// ITALY PIPELINE (mixed-ecosystem buyside pipeline)
// ============================================================================
// Standalone from crm_leads and crm_sellers on purpose: these are buyside
// acquisition-ecosystem contacts, not sales leads, and stay out of the sales
// funnel/outreach. Team-shared (open RLS), so no per-user filter by default.

export async function getItalyPipeline() {
  const { data, error } = await supabase
    .from('crm_italy_pipeline')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createItalyContact(contactData, currentPersonId) {
  const { data, error } = await supabase
    .from('crm_italy_pipeline')
    .insert([{ ...contactData, created_by: currentPersonId }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateItalyContact(id, updates) {
  const cleanUpdates = {}
  Object.keys(updates).forEach(key => {
    if (['id', 'created_at', 'updated_at', 'created_by'].includes(key)) return
    if (updates[key] !== undefined) cleanUpdates[key] = updates[key]
  })
  const { data, error } = await supabase
    .from('crm_italy_pipeline')
    .update(cleanUpdates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function moveItalyContact(id, stage) {
  const { data, error } = await supabase
    .from('crm_italy_pipeline')
    .update({ stage })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteItalyContact(id) {
  const { error } = await supabase
    .from('crm_italy_pipeline')
    .delete()
    .eq('id', id)
  if (error) throw error
}
