/**
 * The board's "needs attention" filter — the bridge from a breach COUNT to the
 * actual rows.
 *
 * The scoreboard (Sept 2026) tells each person how many of their leads are past
 * the 30-day clock, missing required info or unreachable. Until this module
 * existed there was no way to go from that number to the leads themselves: you
 * knew 96 engaged leads had no "how they found us" and had to find them by
 * eye, one card at a time, across five stage columns. A count nobody can act on
 * is a count nobody looks at twice.
 *
 * Pure and page-free on purpose — same reason `targets.js` and `nav.js` are.
 * The predicates are NOT redefined here; every one of them delegates to
 * `leadHealth.js` so the filter, the flag on the lead page and the scoreboard
 * can never disagree about what counts as a problem. The one predicate that is
 * local (`missing_channel`) is deliberately NOT the policy version: see below.
 */

import { isMissingInfo, isUnreachable, isStaleBreach, shouldSurfaceBreach } from './leadHealth'

/**
 * The options, in the order they appear in the dropdown.
 *
 * `missing_channel` sits first because it is the live backlog: 476 of 629 live
 * leads had no channel on 2026-09-29, and nothing can derive the rest — the
 * importer's contract only proved the 152 that came through a bulk LinkedIn
 * import (migration 058). The rest need a human, and this filter plus the
 * selection bar's "Set channel" action is that human's fastest path.
 *
 * It checks the column directly rather than going through `missingRequiredFields`
 * BECAUSE the policy only requires a channel from `responded` onward, and the
 * point of this option is to be able to fill in cold leads in bulk too — a
 * 40-lead import you know came off LinkedIn is answerable now, years before
 * anyone replies. `missing_info` is the stage-aware, policy-respecting one.
 */
export const HEALTH_FILTERS = [
  { value: 'all', label: 'Any' },
  { value: 'missing_channel', label: 'No channel set', match: (l) => !filled(l.lead_channel) },
  { value: 'missing_info', label: 'Missing required info', match: (l) => isMissingInfo(l) },
  { value: 'unreachable', label: 'No way to reach them', match: (l) => isUnreachable(l) },
  // The scoreboard's two stale columns, kept apart here for the same reason
  // they are kept apart there: "needs update" is this month's work, "backlog"
  // is debt. Collapsing them loses Dev's distinction.
  { value: 'needs_update', label: 'Past the 30-day clock (this month)', match: (l, o) => shouldSurfaceBreach(l, o) },
  { value: 'backlog', label: 'Stale backlog (crossed over 30 days ago)',
    match: (l, o) => isStaleBreach(l, o) && !shouldSurfaceBreach(l, o) },
]

function filled(v) {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  return true
}

const BY_VALUE = new Map(HEALTH_FILTERS.map(f => [f.value, f]))

/**
 * Does this lead match the given health filter?
 *
 * An unknown key matches everything rather than nothing: a stale value in
 * sessionStorage (these filters persist across navigation) must never silently
 * empty the board.
 */
export function matchesHealthFilter(lead, value, opts = {}) {
  if (!value || value === 'all') return true
  const f = BY_VALUE.get(value)
  if (!f || !f.match) return true
  return Boolean(f.match(lead, opts))
}

/**
 * How many of these leads each option would show, for the counts in the
 * dropdown. Same reason the Tag filter shows them: an empty list should look
 * empty, not broken.
 */
export function healthFilterCounts(leads, opts = {}) {
  const counts = {}
  for (const f of HEALTH_FILTERS) counts[f.value] = 0
  for (const lead of leads || []) {
    counts.all++
    for (const f of HEALTH_FILTERS) {
      if (f.value === 'all' || !f.match) continue
      if (f.match(lead, opts)) counts[f.value]++
    }
  }
  return counts
}
