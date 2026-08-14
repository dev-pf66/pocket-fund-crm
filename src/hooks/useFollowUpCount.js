import { useState, useEffect, useCallback } from 'react'
import { getFollowUpNotifications } from '../lib/crm-api'

// Reminders don't move minute to minute; a 5-minute poll keeps the badge
// honest across a long-lived tab without hammering Supabase.
const POLL_MS = 5 * 60 * 1000

/** Fire after scheduling/clearing a reminder to refresh the nav badge now. */
export const FOLLOWUPS_CHANGED = 'crm:followups-changed'
export function notifyFollowUpsChanged() {
  window.dispatchEvent(new Event(FOLLOWUPS_CHANGED))
}

/**
 * Live count of the signed-in person's due/overdue reach-outs — feeds the
 * badge on the Notifications nav item. `overdue` is broken out so the badge
 * can go red only when something has actually slipped, rather than shouting
 * about work that's merely due today.
 */
export function useFollowUpCount(personId) {
  const [counts, setCounts] = useState({ total: 0, overdue: 0, dueToday: 0 })

  const refresh = useCallback(() => {
    if (!personId) return
    getFollowUpNotifications(personId, { limit: 0 })
      .then(({ total, overdue, dueToday }) => setCounts({ total, overdue, dueToday }))
      .catch(err => console.error('Follow-up count failed:', err))
  }, [personId])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    // Coming back to the tab should show the truth, not a stale badge.
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    // Any page that schedules or clears a reminder fires this, so the badge
    // drops the moment you act instead of waiting out the poll.
    window.addEventListener(FOLLOWUPS_CHANGED, onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(FOLLOWUPS_CHANGED, onFocus)
    }
  }, [refresh])

  return { ...counts, refresh }
}
