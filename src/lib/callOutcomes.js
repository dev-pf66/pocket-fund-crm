/**
 * Cold call outcome vocabulary — the single source of truth.
 *
 * The Cold Calls page, the funnel math, the caller scorecard and the API
 * layer all read this file. If the list changes, change it here and in the
 * CHECK constraint in migrations/044_cold-calls.sql, and nowhere else.
 *
 * THE DISTINCTION THAT MATTERS
 * ----------------------------
 * A dial is not a touch. Dev's call (Sept 2026): dials count toward the daily
 * goal, but pickups and conversations are what we manage on. So every dial is
 * one row, and the outcome sorts it into a funnel:
 *
 *   dial          every row — someone pressed call
 *   pickup        a human answered (includes gatekeepers and wrong numbers)
 *   conversation  we reached the person we were trying to reach
 *   positive      that conversation went somewhere
 *   meeting       it went all the way
 *
 * A gatekeeper IS a pickup but is NOT a conversation — folding the two
 * together is how call reporting flatters itself. Same for a wrong number.
 */

// Ordered by funnel depth: unreached first, then reached, best last.
// `depth` drives the sort in the outcome breakdown; `pickup`/`conversation`/
// `positive` are the funnel predicates.
export const CALL_OUTCOMES = [
  {
    value: 'no_answer', label: 'No answer', short: 'No answer',
    depth: 0, pickup: false, conversation: false, positive: false,
    color: '#9ca3af', hint: 'Rang out. Try a different time of day.',
  },
  {
    value: 'voicemail', label: 'Left voicemail', short: 'Voicemail',
    depth: 1, pickup: false, conversation: false, positive: false,
    color: '#a78bfa', hint: 'Message left.',
  },
  {
    value: 'bad_number', label: 'Bad number', short: 'Bad number',
    depth: 0, pickup: false, conversation: false, positive: false,
    color: '#78716c', hint: 'Disconnected or invalid — needs a new number.',
  },
  {
    value: 'wrong_person', label: 'Wrong person', short: 'Wrong person',
    depth: 2, pickup: true, conversation: false, positive: false,
    color: '#f59e0b', hint: 'Somebody answered, but not our contact.',
  },
  {
    value: 'gatekeeper', label: 'Gatekeeper', short: 'Gatekeeper',
    depth: 2, pickup: true, conversation: false, positive: false,
    color: '#fb923c', hint: 'Blocked before reaching them. A pickup, not a conversation.',
  },
  {
    value: 'not_interested', label: 'Not interested', short: 'Not interested',
    depth: 3, pickup: true, conversation: true, positive: false,
    color: '#dc2626', hint: 'Reached them and they said no. Still a conversation.',
  },
  {
    value: 'callback', label: 'Call back later', short: 'Callback',
    depth: 4, pickup: true, conversation: true, positive: false,
    color: '#0ea5e9', hint: 'Reached them, they asked for another time.',
  },
  {
    value: 'interested', label: 'Interested', short: 'Interested',
    depth: 5, pickup: true, conversation: true, positive: true,
    color: '#16a34a', hint: 'Real conversation, wants to keep talking.',
  },
  {
    value: 'meeting_booked', label: 'Meeting booked', short: 'Meeting',
    depth: 6, pickup: true, conversation: true, positive: true,
    color: '#15803d', hint: 'On the calendar. Moves the lead to meeting_booked.',
  },
  {
    value: 'do_not_call', label: 'Do not call', short: 'DNC',
    depth: 3, pickup: true, conversation: true, positive: false,
    color: '#450a0a', hint: 'Asked never to be called again. Flags the lead.',
  },
]

const BY_VALUE = new Map(CALL_OUTCOMES.map(o => [o.value, o]))

export const CALL_OUTCOME_VALUES = CALL_OUTCOMES.map(o => o.value)

export function outcomeMeta(value) {
  return BY_VALUE.get(value) || null
}

export function outcomeLabel(value) {
  return BY_VALUE.get(value)?.label || (value ? String(value).replace(/_/g, ' ') : '—')
}

export function outcomeColor(value) {
  return BY_VALUE.get(value)?.color || '#9ca3af'
}

export function isValidOutcome(value) {
  return BY_VALUE.has(value)
}

/** A human answered. Gatekeepers and wrong numbers count — they picked up. */
export function isPickup(value) {
  return BY_VALUE.get(value)?.pickup === true
}

/** We reached the person we were trying to reach. Gatekeepers do NOT count. */
export function isConversation(value) {
  return BY_VALUE.get(value)?.conversation === true
}

/** The conversation went somewhere: interested, or a meeting on the calendar. */
export function isPositive(value) {
  return BY_VALUE.get(value)?.positive === true
}

/**
 * Map a call outcome onto the legacy crm_outreach_log.status vocabulary
 * ('sent' | 'replied' | 'no_response' | 'bounced').
 *
 * Every call row carries a status so that reply rate, the weekly digest, the
 * pipeline response filter and the movement metrics keep reading one column
 * and never have to learn what a gatekeeper is.
 *
 * The rule is "did they respond to us", not "did we like the answer":
 *   - reached them at all (including a flat no, including a DNC) → replied
 *   - a gatekeeper or wrong number is NOT them responding      → no_response
 *   - rang out / voicemail                                     → no_response
 *   - dead number is undeliverable, exactly like a bounce      → bounced
 *
 * Counting "not interested" as a reply is deliberate. It IS a response, and
 * pretending otherwise would quietly inflate the outstanding-conversations
 * number with people who have already said no.
 */
export function statusForOutcome(value) {
  if (value === 'bad_number') return 'bounced'
  if (isConversation(value)) return 'replied'
  return 'no_response'
}

/**
 * Aggregate a set of call rows into the funnel. Rows are anything carrying
 * `call_outcome`; `connected` is preferred over the outcome for the pickup
 * count when present, because a provider webhook knows answered/not from the
 * carrier and the caller's own selection can be sloppier.
 *
 * Rates are percentages of the level above, and are null (not 0) when the
 * denominator is 0 — "0% pickup rate on 0 dials" reads as a crisis rather
 * than as no data.
 */
export function summarizeCalls(rows = []) {
  let dials = 0, pickups = 0, conversations = 0, positive = 0, meetings = 0
  let talkSeconds = 0, talkRows = 0
  const byOutcome = new Map()

  for (const r of rows) {
    dials += 1
    const outcome = r.call_outcome || null
    byOutcome.set(outcome, (byOutcome.get(outcome) || 0) + 1)
    // An explicit `connected` from the provider wins; fall back to the outcome.
    if (r.connected === true || (r.connected == null && isPickup(outcome))) pickups += 1
    if (isConversation(outcome)) conversations += 1
    if (isPositive(outcome)) positive += 1
    if (outcome === 'meeting_booked') meetings += 1
    if (r.call_duration_seconds > 0) { talkSeconds += r.call_duration_seconds; talkRows += 1 }
  }

  return {
    dials,
    pickups,
    conversations,
    positive,
    meetings,
    talkSeconds,
    // Rate of each level against the one above it.
    pickupRate: rate(pickups, dials),
    conversationRate: rate(conversations, pickups),
    positiveRate: rate(positive, conversations),
    meetingRate: rate(meetings, conversations),
    // The unit economics of the channel: how many dials buy one meeting.
    dialsPerMeeting: meetings > 0 ? dials / meetings : null,
    avgTalkSeconds: talkRows > 0 ? talkSeconds / talkRows : null,
    byOutcome,
  }
}

/** Percentage, or null when there is nothing to divide by. */
export function rate(numerator, denominator) {
  if (!denominator) return null
  return (numerator / denominator) * 100
}

/** "12%" / "—". Keeps every rate rendering identical across the page. */
export function fmtRate(value, digits = 0) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/** Seconds → "4m 12s" / "48s" / "—". */
export function fmtDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}
