/**
 * CRM API — lead cover: one person works another person's book.
 *
 * Every work surface is scoped on crm_leads.assigned_to. A person maintaining
 * someone else's leads could open them (RLS is team-wide) but no surface ever
 * told them about one — Dev's leads going quiet nagged only Dev, who is
 * escalation-only, so nobody worked them (Dev, 2026-10-29: Sidharth "is
 * helping me manage and maintain all my leads").
 *
 * A crm_lead_cover row (migration 062) widens the coverer's work surfaces to
 * the owner's leads. Ownership never moves and credit follows whoever logs the
 * work. Breach counts on the scoreboard stay on the owner's row only — copying
 * them to the coverer would count one lead twice in the team totals.
 *
 * Every owner-scoped work query goes through ownerScopeIds + scopeToOwners
 * rather than a hand-written .eq('assigned_to', personId). Guardrail:
 * test/lead-cover.test.js.
 */

import { supabase } from '../supabase.js'
import { cacheGet, cacheSet, cacheClear } from './core.js'

const COVER_TTL_MS = 60 * 1000

/**
 * The owner ids whose books `personId` covers (open rows only). Memoised 60s:
 * the Today tab, the feed and the bell all resolve it on every load.
 *
 * Fails OPEN to "covers nobody": if the table is unreachable the surfaces fall
 * back to the person's own leads rather than blanking the Today tab for the
 * whole team. Logged loudly so it is not a silent degrade.
 */
export async function getCoveredOwnerIds(personId) {
  if (!personId) return []
  const key = `cover:${personId}`
  const hit = cacheGet(key, COVER_TTL_MS)
  if (hit) return hit

  const { data, error } = await supabase
    .from('crm_lead_cover')
    .select('owner_id')
    .eq('coverer_id', personId)
    .is('ended_at', null)
  if (error) {
    console.error('getCoveredOwnerIds: crm_lead_cover unreadable, showing own leads only', error)
    return []
  }
  const ids = [...new Set((data || []).map(r => r.owner_id).filter(id => id != null && id !== personId))]
  cacheSet(key, ids)
  return ids
}

/**
 * Everyone whose leads belong on `personId`'s work surfaces: themselves first,
 * then each owner they cover. null in, null out — null means "every owner"
 * (the admin view) and must stay unscoped.
 */
export async function ownerScopeIds(personId) {
  if (!personId) return null
  return [personId, ...(await getCoveredOwnerIds(personId))]
}

/** Apply an ownerScopeIds result to a crm_leads query. null → unscoped. */
export function scopeToOwners(q, ids, column = 'assigned_to') {
  if (!ids) return q
  return ids.length === 1 ? q.eq(column, ids[0]) : q.in(column, ids)
}

/** Open cover links, every pair — what Admin → All Users renders. */
export async function getLeadCoverLinks() {
  const { data, error } = await supabase
    .from('crm_lead_cover')
    .select('id, coverer_id, owner_id, created_at, created_by')
    .is('ended_at', null)
    .order('id')
  if (error) throw error
  return data || []
}

/** Start covering. Idempotent: an already-open pair is returned, not duplicated. */
export async function startLeadCover(covererId, ownerId, currentPersonId = null) {
  if (!covererId || !ownerId) throw new Error('startLeadCover: coverer and owner are required')
  if (Number(covererId) === Number(ownerId)) throw new Error('A person cannot cover their own leads')

  const { data: open, error: readErr } = await supabase
    .from('crm_lead_cover')
    .select('id, coverer_id, owner_id, created_at, created_by')
    .eq('coverer_id', covererId)
    .eq('owner_id', ownerId)
    .is('ended_at', null)
  if (readErr) throw readErr
  if (open?.length) return open[0]

  const { data, error } = await supabase
    .from('crm_lead_cover')
    .insert({ coverer_id: covererId, owner_id: ownerId, created_by: currentPersonId })
    .select('id, coverer_id, owner_id, created_at, created_by')
    .single()
  if (error) throw error
  cacheClear(`cover:${covererId}`)
  return data
}

/** Stop covering. Stamps ended_at — never deletes the row. */
export async function endLeadCover(covererId, ownerId, currentPersonId = null) {
  const { error } = await supabase
    .from('crm_lead_cover')
    .update({ ended_at: new Date().toISOString(), ended_by: currentPersonId })
    .eq('coverer_id', covererId)
    .eq('owner_id', ownerId)
    .is('ended_at', null)
  if (error) throw error
  cacheClear(`cover:${covererId}`)
}
