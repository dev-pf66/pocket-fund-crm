/**
 * CRM API — archiving leads.
 *
 * Archiving is how a lead leaves the working surfaces without leaving the
 * database. It mirrors people.is_archived (migration 029): the row is fully
 * retained, every activity and call against it is retained, and un-archiving
 * is one flag flip. Nothing here deletes anything — `deleteLead` still exists
 * for genuine mistakes and is a different, deliberate act.
 *
 * Why it exists: the pipeline reached 1,122 leads with roughly a third of them
 * untouched for over 90 days. Dead weight doesn't just sit there — it pads
 * every stage count, and it turns the notification feed into a list nobody
 * can work, which is the same as having no notifications at all.
 *
 * THE SWEEP IS PREVIEW-FIRST ON PURPOSE
 * -------------------------------------
 * Bulk-flagging several hundred production rows is reversible but not
 * costless — everyone's board changes at once. So `previewArchiveSweep`
 * returns the exact per-stage breakdown and a sample, and `runArchiveSweep`
 * takes that same criteria object. Nothing sweeps on a schedule or on load.
 */

import { supabase } from '../supabase'
import { istToday, istAddDays } from '../dateUtils'
import { cacheClear, fetchAllRows } from './core'

/** Won deals are never swept. A client going quiet is an account-management
 *  problem, not pipeline clutter, and burying it is how a renewal gets missed. */
export const NEVER_SWEEP_STAGES = ['client']

/** Engaged means someone on the other side actually responded to us. */
export const ENGAGED_STAGES = ['responded', 'meeting_booked', 'warm_active']

export const DEFAULT_SWEEP_DAYS = 90

/**
 * The day a lead was last genuinely touched. Falls back to created_at so an
 * imported lead nobody ever worked still ages — otherwise a null activity
 * date would make it immortal.
 */
export function lastTouchedOn(lead) {
  const ref = lead?.last_activity_date || lead?.created_at
  return ref ? String(ref).slice(0, 10) : null
}

/**
 * Does this lead match the sweep criteria?
 *
 * Exported and pure so the preview, the executor and the tests all decide
 * with the same function — a preview that disagrees with what actually runs
 * is worse than no preview.
 */
export function matchesSweep(lead, { cutoff, includeEngaged = true, keepScheduled = true }) {
  if (!lead) return false
  if (lead.is_archived) return false
  if (NEVER_SWEEP_STAGES.includes(lead.stage)) return false
  if (!includeEngaged && ENGAGED_STAGES.includes(lead.stage)) return false
  // A live reminder is a person saying "I am still working this". Outrank the
  // date heuristic; a scheduled lead is by definition not forgotten.
  if (keepScheduled && lead.next_follow_up_date) return false

  const touched = lastTouchedOn(lead)
  if (!touched) return false
  return touched < cutoff
}

/** Resolve sweep options into the concrete criteria both halves share. */
export function sweepCriteria({ days = DEFAULT_SWEEP_DAYS, includeEngaged = true, keepScheduled = true } = {}) {
  const n = Number(days)
  if (!Number.isFinite(n) || n < 1) throw new Error('Sweep needs a positive number of days')
  return { days: n, cutoff: istAddDays(istToday(), -n), includeEngaged, keepScheduled }
}

/**
 * What a sweep WOULD archive. Read-only.
 *
 * Returns the per-stage breakdown as well as the total, because "archive 316
 * leads" and "archive 134 people who replied to us" are the same sentence
 * until you split it by stage.
 */
export async function previewArchiveSweep(options = {}) {
  const criteria = sweepCriteria(options)

  // Paged: this counts and aggregates, and the table is past 1,000 rows.
  const leads = await fetchAllRows(() => supabase
    .from('crm_leads')
    .select('id, name, firm_name, stage, assigned_to, last_activity_date, created_at, next_follow_up_date, is_archived')
    .eq('is_archived', false)
    .order('id'))

  const matched = leads.filter(l => matchesSweep(l, criteria))

  const byStage = {}
  for (const l of matched) byStage[l.stage] = (byStage[l.stage] || 0) + 1

  // Oldest first: the sample should show the least defensible rows, not a
  // random slice that makes the sweep look gentler than it is.
  const sample = [...matched]
    .sort((a, b) => String(lastTouchedOn(a)).localeCompare(String(lastTouchedOn(b))))
    .slice(0, 20)
    .map(l => ({
      id: l.id,
      name: l.name,
      firm_name: l.firm_name,
      stage: l.stage,
      lastTouched: lastTouchedOn(l)
    }))

  return {
    criteria,
    total: matched.length,
    scanned: leads.length,
    byStage,
    sample,
    ids: matched.map(l => l.id)
  }
}

/**
 * Archive every lead matching the criteria.
 *
 * Re-derives the match set rather than trusting ids handed in from a preview
 * taken minutes ago — otherwise a lead worked in between gets archived on the
 * strength of a stale read. Writes in chunks because a PostgREST `in` filter
 * with several hundred ids makes a URL long enough to get rejected.
 */
export async function runArchiveSweep(options = {}, currentPersonId = null) {
  const preview = await previewArchiveSweep(options)
  if (preview.total === 0) return { archived: 0, archivedAt: null, criteria: preview.criteria, byStage: {} }

  const reason = `Bulk sweep: no activity in ${preview.criteria.days} days`
  const stamp = new Date().toISOString()
  const CHUNK = 100
  let archived = 0

  for (let i = 0; i < preview.ids.length; i += CHUNK) {
    const chunk = preview.ids.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('crm_leads')
      .update({ is_archived: true, archived_at: stamp, archived_reason: reason, archived_by: currentPersonId })
      .in('id', chunk)
      .select('id')
    if (error) throw error
    archived += (data || []).length
  }

  cacheClear('leads')
  // archivedAt is the undo handle: every row in this sweep carries it.
  // archived_by (migration 051) is on the rows too, not just in this return
  // value — "who buried 300 leads" is the first question asked afterwards, and
  // it used to be unanswerable the moment this function returned.
  return { archived, archivedAt: stamp, criteria: preview.criteria, byStage: preview.byStage, by: currentPersonId }
}

/**
 * Archive or restore one lead. The per-row escape hatch from a bulk sweep.
 *
 * Restoring clears archived_by along with the stamp and the reason: the row is
 * live again, and leaving an actor on it would read as though it were still
 * archived by that person.
 */
export async function setLeadArchived(leadId, archived = true, { reason = null, currentPersonId = null } = {}) {
  const updates = archived
    ? { is_archived: true, archived_at: new Date().toISOString(), archived_reason: reason || 'Archived by hand', archived_by: currentPersonId }
    : { is_archived: false, archived_at: null, archived_reason: null, archived_by: null }

  const { data, error } = await supabase
    .from('crm_leads')
    .update(updates)
    .eq('id', leadId)
    .select()
    .single()
  if (error) throw error
  cacheClear('leads')
  return data
}

/**
 * The archived book, newest archive first — so a sweep can be reviewed and
 * undone right after it runs, which is the whole reason it's safe to run.
 */
export async function getArchivedLeads({ limit = 500 } = {}) {
  const rows = await fetchAllRows(() => supabase
    .from('crm_leads')
    .select('*')
    .eq('is_archived', true)
    .order('archived_at', { ascending: false })
    .order('id'), { maxRows: limit })
  return rows
}

/**
 * Undo an entire sweep: restore everything archived with a given stamp.
 * `archived_at` is identical across one sweep's rows precisely so this works.
 */
export async function undoArchiveSweep(archivedAt) {
  if (!archivedAt) throw new Error('undoArchiveSweep needs the sweep timestamp')
  const { data, error } = await supabase
    .from('crm_leads')
    .update({ is_archived: false, archived_at: null, archived_reason: null, archived_by: null })
    .eq('archived_at', archivedAt)
    .select('id')
  if (error) throw error
  cacheClear('leads')
  return { restored: (data || []).length }
}
