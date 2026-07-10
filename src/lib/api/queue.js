/**
 * CRM API — outreach queue: bulk lead import from LinkedIn URLs, the
 * per-person first-touch queue, and the reached-out transition.
 */

import { supabase } from '../supabase'
import { normalizeLinkedInUrl, nameFromLinkedInUrl } from '../linkedin'
import { cacheClear } from './core'
import { logOutreach } from './outreach'

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
