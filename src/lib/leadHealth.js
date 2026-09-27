/**
 * What makes a lead healthy: does it carry the information we agreed every
 * lead needs, and has anyone touched it lately.
 *
 * Pure and dependency-free so both the UI and the per-person scoreboard decide
 * with the same function — a flag on the lead page that disagrees with the
 * number on the scoreboard is worse than neither.
 *
 * THE RULES, FROM DEV (Sept 2026)
 * ------------------------------
 *  - **Required info is a FLAG, not a block.** "It will be a basic flag if
 *    it's not all the info." Nothing here prevents saving, moving or working a
 *    lead. A hard gate in a shared CRM gets worked around, and the worked-around
 *    version is a lead with fake data in it instead of a lead with a flag on it.
 *  - **The 30-day clock is a RUNNING clock.** Not "30 days from the meeting,
 *    once" — a rolling window from the last touch that resets every time the
 *    lead is worked. This deliberately matches the continuous staleness the
 *    notification feed uses; the old day-3/7/14 exact-match pattern is why 179
 *    engaged leads scored nothing and must not be copied.
 *
 * Why these fields: they are the questions Dev and Om agreed every lead should
 * answer — buyer type, how fast they want to move, how they found us, whether
 * they have a thesis, what they have bought before, and how we would get paid.
 * Keep this list short. Every field added here flags more leads, and a flag
 * that is always on is not a flag.
 */

/** The rolling window, in days, before an untouched lead is in breach. */
export const STALE_BREACH_DAYS = 30

/**
 * How long after crossing the clock a breach keeps SURFACING in the working
 * queue and the notification feed.
 *
 * Dev, 27 Sept 2026, on the 73-lead backlog: "the backlog is fine... let's just
 * do the last two weeks, or the last thirty days — let those start coming up.
 * And for the backlog, just keep them as unupdated for now so that we have to
 * update it." So a breach that crossed recently is work for this week; one that
 * crossed months ago stays flagged and stays counted, but does not shout.
 *
 * NOTE THIS IS A DISPLAY FLOOR, and the Sept 2026 notification rework
 * deliberately removed one ("There is no display floor... Forgetting is now an
 * explicit act — you archive the lead"). Dev overruled that here, knowingly: the
 * two rules were solving different problems. The no-floor rule stopped a
 * follow-up going quiet forever after day 14. This stops 73 leads landing on one
 * person's queue in a single morning, which is its own way of being ignored.
 * The backlog does not disappear — isStaleBreach still returns true for all of
 * it, the scoreboard still counts all of it, and the lead page still flags it.
 * Only the nagging is windowed.
 */
export const STALE_SURFACE_WINDOW_DAYS = 30

/**
 * Pipeline order, for "this field is required from stage X onward".
 * Mirrors STAGE_ORDER in src/lib/api/leads.js. `passed` and `reach_out_later`
 * sit outside it and never require anything.
 */
const STAGE_SEQUENCE = ['outreach', 'responded', 'meeting_booked', 'warm_active', 'client']
const rank = (stage) => STAGE_SEQUENCE.indexOf(stage)

/**
 * Required info, each field carrying the stage it becomes required AT (and at
 * every stage after).
 *
 * TWO TIERS, AND THE REASON MATTERS. Dev's words were "a minimum amount of
 * information for a lead once you're putting it in MeetingBooked" — so the full
 * set is gated on the meeting, not on a reply. Requiring all six from
 * `responded` flagged 115 of 116 engaged leads, and a flag that is on for 99% of
 * the book tells nobody anything.
 *
 * The two exceptions are required a stage earlier because they are answerable
 * from the reply itself and are the ones Dev wants for channel attribution
 * ("in sales we put in 30 hours and got so many leads, in SEO we put in 10") —
 * if they only became required at the meeting, the 54 leads that replied and
 * never met would never carry them, which is exactly the population the inbound
 * vs outbound question is about.
 *
 * Editing this list is the intended way to change the policy: it is the single
 * source for the flag, the missing-field list on the lead page, and the
 * scoreboard's count.
 */
export const REQUIRED_LEAD_FIELDS = [
  { key: 'lead_channel',      label: 'How they found us',        fromStage: 'responded' },
  { key: 'lead_type',         label: 'Buyer type',               fromStage: 'responded' },
  { key: 'buying_timeline',   label: 'How soon they want to buy', fromStage: 'meeting_booked' },
  { key: 'investment_thesis', label: 'Do they have a thesis',     fromStage: 'meeting_booked' },
  { key: 'prior_acquisitions', label: 'Acquisitions so far',      fromStage: 'meeting_booked' },
  { key: 'engagement_model',  label: 'Retainer or success fee',   fromStage: 'meeting_booked' },
]

/**
 * The earliest stage at which anything is required.
 *
 * Nothing is required at `outreach`: a cold lead nobody has spoken to cannot be
 * expected to have answered anything, and flagging 446 untouched cold leads for
 * having no thesis would make the flag meaningless everywhere it matters.
 */
export const INFO_REQUIRED_FROM_STAGE = ['responded', 'meeting_booked', 'warm_active', 'client']

/** Is this value actually filled in? Whitespace and empty strings are not. */
function filled(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

/** Does the required info apply to this lead yet? */
export function infoRequiredFor(lead) {
  if (!lead || lead.is_archived) return false
  return INFO_REQUIRED_FROM_STAGE.includes(lead.stage)
}

/**
 * Which required fields are still blank, for the stage this lead has actually
 * reached. Returns [] for a lead the policy does not apply to yet, so callers
 * can treat "nothing missing" uniformly without having to ask whether the rules
 * were in force.
 */
export function missingRequiredFields(lead) {
  if (!infoRequiredFor(lead)) return []
  const at = rank(lead.stage)
  return REQUIRED_LEAD_FIELDS
    .filter(f => at >= rank(f.fromStage))
    .filter(f => !filled(lead[f.key]))
}

/** Every field this lead is expected to carry at its current stage. */
export function requiredFieldsFor(lead) {
  if (!infoRequiredFor(lead)) return []
  const at = rank(lead.stage)
  return REQUIRED_LEAD_FIELDS.filter(f => at >= rank(f.fromStage))
}

/** The flag itself. True when a lead that should be complete is not. */
export function isMissingInfo(lead) {
  return missingRequiredFields(lead).length > 0
}

/**
 * Days since anyone last said anything about this lead.
 *
 * `disposed_at` counts as a touch, and deliberately so: the clock measures "has
 * someone said what is happening with this", not merely "has a row changed". An
 * owner who opens a lead and records a disposition has answered the question the
 * clock is asking, even if nothing else about the lead moved.
 *
 * Falls back to created_at so an imported lead nobody ever worked still ages.
 * Null when no date is on file at all — unknown, which is not the same as fresh.
 */
export function daysSinceTouch(lead, now = new Date()) {
  const candidates = [lead?.last_activity_date, lead?.disposed_at, lead?.created_at].filter(Boolean)
  if (!candidates.length) return null
  // Most recent wins — a lead touched today and disposed last month is not stale.
  const ref = candidates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
  const ms = now - new Date(ref)
  return Math.floor(ms / 86400000)
}

/**
 * How far PAST the clock this lead is. Negative or null means not in breach.
 * Exported because "crossed recently" and "crossed months ago" are different
 * kinds of work and the queue needs to tell them apart.
 */
export function daysOverClock(lead, { now = new Date(), days = STALE_BREACH_DAYS } = {}) {
  const d = daysSinceTouch(lead, now)
  return d == null ? null : d - days
}

/**
 * Is this lead past the running 30-day clock?
 *
 * A lead with a follow-up scheduled from today onward is NOT in breach,
 * whatever its last-touch date says — somebody has explicitly said they are
 * still working it, and that outranks the date heuristic. Same rule the archive
 * sweep uses, deliberately: two surfaces disagreeing about whether a lead is
 * abandoned is how people stop trusting both.
 *
 * Archived, client and passed leads are never in breach. A won deal going quiet
 * is account management, and a dead lead is supposed to be quiet.
 */
export function isStaleBreach(lead, { today = null, now = new Date(), days = STALE_BREACH_DAYS } = {}) {
  if (!lead || lead.is_archived) return false
  if (lead.stage === 'client' || lead.stage === 'passed') return false
  const todayStr = today ?? new Date(now).toISOString().slice(0, 10)
  if (lead.next_follow_up_date && lead.next_follow_up_date >= todayStr) return false
  const d = daysSinceTouch(lead, now)
  return d != null && d >= days
}

/**
 * Should this breach be pushed at someone right now, as opposed to merely
 * counted?
 *
 * True only for a lead that crossed the clock within STALE_SURFACE_WINDOW_DAYS.
 * Everything older is still a breach — still flagged on the lead, still in the
 * scoreboard's count — it just is not in this week's queue. See the note on
 * STALE_SURFACE_WINDOW_DAYS for why this floor exists when the notification
 * rework removed one.
 */
export function shouldSurfaceBreach(lead, opts = {}) {
  if (!isStaleBreach(lead, opts)) return false
  const over = daysOverClock(lead, opts)
  return over != null && over <= (opts.window ?? STALE_SURFACE_WINDOW_DAYS)
}

/**
 * Everything wrong with one lead, for the badge on the lead page and the
 * per-person counts on the scoreboard.
 *
 * `needsTranscript`: a lead that has reached the meeting stage should have a
 * record of the conversation. Dev and Om both said it on the call — "any lead
 * that's on the meeting stage, it should have a transcript". The caller passes
 * whether one exists, because that lives in another table.
 */
export function leadBreaches(lead, { hasTranscript = null, today = null, now = new Date() } = {}) {
  const missing = missingRequiredFields(lead)
  const reachedMeeting = ['meeting_booked', 'warm_active', 'client'].includes(lead?.stage)
  return {
    missingInfo: missing.length > 0,
    missingFields: missing,
    staleBreach: isStaleBreach(lead, { today, now }),
    staleSurfacing: shouldSurfaceBreach(lead, { today, now }),
    staleDays: daysSinceTouch(lead, now),
    daysOverClock: daysOverClock(lead, { now }),
    // null means "not checked" — never report a missing transcript we did not look for.
    needsTranscript: hasTranscript === null ? false : (reachedMeeting && !lead?.is_archived && !hasTranscript),
  }
}

/** Does this lead have anything wrong with it at all? */
export function hasAnyBreach(breaches) {
  return Boolean(breaches.missingInfo || breaches.staleBreach || breaches.needsTranscript)
}
