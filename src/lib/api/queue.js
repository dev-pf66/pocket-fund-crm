/**
 * CRM API — outreach queue: bulk lead import from LinkedIn URLs, the
 * per-person first-touch queue, and the reached-out transition.
 */

import { supabase } from '../supabase'
import { normalizeLinkedInUrl, nameFromLinkedInUrl } from '../linkedin'
import { cacheClear, fetchAllRows } from './core'
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

  // Paginated: a plain select stops at PostgREST's 1000-row cap without
  // erroring, which would silently defeat the dedupe this function exists for
  // once crm_leads outgrows it — reimporting existing people as duplicates.
  const existing = await fetchAllRows(() => supabase
    .from('crm_leads')
    .select('linkedin_url')
    .not('linkedin_url', 'is', null))
  const existingNormalized = new Set(
    existing.map(l => normalizeLinkedInUrl(l.linkedin_url)).filter(Boolean)
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
    stage: 'outreach',
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

// new_lead and cold_outreach merged into a single 'outreach' stage, so stage
// alone can no longer tell "never contacted" from "contacted, no reply yet" —
// that's now whether the lead has any crm_outreach_log row at all.
async function getTouchedLeadIds(leadIds) {
  if (!leadIds.length) return new Set()
  const rows = await fetchAllRows(() => supabase
    .from('crm_outreach_log')
    .select('lead_id')
    .in('lead_id', leadIds))
  return new Set(rows.map(r => r.lead_id))
}

export async function getOutreachQueue(currentPersonId) {
  if (!currentPersonId) return { leads: [], batchStats: {} }
  const { data: queue, error } = await supabase
    .from('crm_leads')
    .select('*')
    .eq('assigned_to', currentPersonId)
    .eq('stage', 'outreach')
    .order('created_at', { ascending: false })
  if (error) throw error

  const candidates = queue || []
  const touchedIds = await getTouchedLeadIds(candidates.map(l => l.id))
  const untouched = candidates.filter(l => !touchedIds.has(l.id))

  const batchIds = [...new Set(untouched.map(l => l.import_batch_id).filter(Boolean))]
  const batchStats = {}
  if (batchIds.length > 0) {
    // Paged: import batches are bulk by definition, so a >1000-lead import
    // would report wrong "x of y contacted" progress.
    const batchLeads = await fetchAllRows(() => supabase
      .from('crm_leads')
      .select('id, import_batch_id')
      .eq('assigned_to', currentPersonId)
      .in('import_batch_id', batchIds))
    const batchTouched = await getTouchedLeadIds(batchLeads.map(l => l.id))
    for (const row of batchLeads) {
      const id = row.import_batch_id
      if (!batchStats[id]) batchStats[id] = { total: 0, contacted: 0 }
      batchStats[id].total += 1
      if (batchTouched.has(row.id)) batchStats[id].contacted += 1
    }
  }
  return { leads: untouched, batchStats }
}

// Mark a queued lead as reached out: logs a LinkedIn outreach entry. Stage
// stays 'outreach' — new_lead and cold_outreach are one stage now, so the
// outreach log entry itself (not a stage move) is what drops this lead out
// of the queue.
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
