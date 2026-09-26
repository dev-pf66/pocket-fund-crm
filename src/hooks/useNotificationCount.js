import { useState, useEffect, useCallback } from 'react'
import { getNotificationCounts } from '../lib/crm-api'

// Reminders don't move minute to minute; a 5-minute poll keeps the badge
// honest across a long-lived tab without hammering Supabase.
const POLL_MS = 5 * 60 * 1000

/** Fire after anything that changes the feed so the nav badge refreshes now. */
export const NOTIFICATIONS_CHANGED = 'crm:notifications-changed'
export function notifyFollowUpsChanged() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED))
}

/**
 * Live count of what needs this person now — overdue plus due today, across
 * every signal in the feed (scheduled follow-ups, promised callbacks, demos,
 * leads that have gone quiet), not just the one date column the badge used to
 * watch. `overdue` is broken out so the badge goes red only when something
 * has actually slipped rather than shouting about work that is merely due.
 *
 * `degraded` is surfaced rather than swallowed: if one signal source failed,
 * the number is a floor, and the UI should say so instead of quietly
 * under-reporting.
 */
export function useNotificationCount(personId, { isAdmin = false } = {}) {
  const [counts, setCounts] = useState({ total: 0, overdue: 0, dueToday: 0, degraded: false })

  const refresh = useCallback(() => {
    if (!personId) return
    getNotificationCounts(personId, { isAdmin })
      .then(c => setCounts({
        total: c.total,
        overdue: c.overdue,
        dueToday: c.dueToday,
        degraded: c.degraded
      }))
      .catch(err => console.error('Notification count failed:', err))
  }, [personId, isAdmin])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    // Coming back to the tab should show the truth, not a stale badge.
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    // Any page that acts on a notification fires this, so the badge drops the
    // moment you act instead of waiting out the poll.
    window.addEventListener(NOTIFICATIONS_CHANGED, onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(NOTIFICATIONS_CHANGED, onFocus)
    }
  }, [refresh])

  return { ...counts, refresh }
}
