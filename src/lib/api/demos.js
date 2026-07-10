/**
 * CRM API — PE OS demos (crm_demos).
 */

import { supabase } from '../supabase'

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
