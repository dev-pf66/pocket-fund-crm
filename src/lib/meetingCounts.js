/**
 * What counts as a meeting. One definition, imported by both surfaces that
 * report one, so Sage and the CRM cannot disagree.
 *
 * Dev, 27 Sept 2026: "Sage and CRM should not at all disagree with meetings.
 * That should not be the case." They did. Three different numbers were in play:
 *
 *   1. The Monday Sage digest counted `activity_type IN ('call', 'meeting')` and
 *      printed the total under the word "meetings" — so a logged phone call was
 *      reported to Dev as a meeting. Its own comment said it counted leads
 *      "entering meeting_booked", which is not what the query did and not how
 *      the activity is written either.
 *   2. The meeting activity is auto-logged when a lead LEAVES `meeting_booked`
 *      moving forward, because `meeting_booked` means "agreed to meet", not
 *      "met". So that activity is a meeting that HAPPENED.
 *   3. The per-person scoreboard counted stage events INTO `meeting_booked` —
 *      a meeting BOOKED, which may not have happened yet.
 *
 * Both 2 and 3 are worth knowing and they are different questions ("did the work
 * land" vs "is the work coming"). The fix is not to pick one and quietly drop
 * the other — it is to stop using the bare word "meetings" for either, and to
 * derive both from this module so the two reports cannot drift.
 *
 * Pure and dependency-free: api/weekly-digest.js runs in the serverless
 * environment and cannot import the browser Supabase client, but it already
 * imports src/lib/linkedin.js and src/lib/integrations/task-tracker.js, so a
 * pure module is the established way to share a rule across that boundary.
 */

/**
 * Activity types that mean a conversation actually took place.
 *
 * 'call' is NOT here. A call is a call — it belongs in the outreach and dial
 * counts, where it already is. Folding it into "meetings" inflates the one
 * number Dev reads first on a Monday, and it is the same mistake the cold-call
 * page exists to avoid: a gatekeeper is a pickup, not a conversation.
 */
export const MEETING_HELD_ACTIVITY_TYPES = ['meeting']

/** Stage that means the lead has agreed to meet but has not met yet. */
export const MEETING_BOOKED_STAGE = 'meeting_booked'

/**
 * Stage names retired by the Sept 2026 restructure, mapped to what they became.
 * crm_lead_stage_events is append-only, so it still holds `cold_outreach` (27
 * events) and `warm_lead` (2). Group by stage without mapping these and the
 * history silently under-counts.
 */
const RETIRED_STAGES = {
  cold_outreach: 'outreach',
  new_lead: 'outreach',
  warm_lead: 'warm_active',
  active_conversation: 'warm_active',
}

export const canonicalStage = (stage) => RETIRED_STAGES[stage] ?? stage

/** Did this activity row record a meeting that happened? */
export const isMeetingHeld = (activity) =>
  MEETING_HELD_ACTIVITY_TYPES.includes(activity?.activity_type)

/** Did this stage event record a meeting being booked? */
export const isMeetingBooked = (event) =>
  canonicalStage(event?.to_stage) === MEETING_BOOKED_STAGE
