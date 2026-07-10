/**
 * CRM API — shared internals (cache, event dispatch, date/day helpers).
 *
 * Deliberately NOT re-exported wholesale by the crm-api barrel: only
 * cacheClear/cachePeek are public (surfaced via ./cache). The other exports
 * here are internal — sibling modules import them directly from './core'.
 */

import { supabase } from '../supabase'
import { IST_OFFSET_MS } from '../dateUtils'

// Accepts an optional utcMs so callers can get the IST date for a specific
// moment; defaults to now. All other code should call istToday() directly.
export function istDateStr(utcMs = Date.now()) {
  return new Date(utcMs + IST_OFFSET_MS).toISOString().split('T')[0]
}

// Fire-and-forget post to the server-side event dispatcher.
// Never blocks the caller; errors are logged but swallowed.
export async function fireTTEvent(event_type, payload) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return
    await fetch('/api/events/fire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ event_type, payload })
    })
  } catch (e) { console.error('fireTTEvent failed', e) }
}

// ============================================================================
// IN-MEMORY CACHE
// ============================================================================

const _cache = new Map()

export function cacheGet(key, ttlMs) {
  const entry = _cache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.ts > ttlMs) {
    _cache.delete(key)
    return undefined
  }
  return entry.data
}

export function cacheSet(key, data) {
  _cache.set(key, { data, ts: Date.now() })
}

export function cacheClear(prefix) {
  if (!prefix) { _cache.clear(); return }
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key)
  }
}

// Synchronous cache peek — lets components render immediately with cached data
// on mount (stale-while-revalidate), avoiding the spinner flash on sidebar nav.
// Uses a longer TTL than the fetchers because stale data is fine to show while
// the background refetch runs.
export function cachePeek(key, ttlMs = 5 * 60 * 1000) {
  return cacheGet(key, ttlMs)
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate days between two dates
 */
export function getDaysBetween(date1, date2) {
  const diffTime = Math.abs(date2 - date1)
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return diffDays
}
