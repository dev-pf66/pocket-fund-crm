/**
 * CRM API — the per-person weekly scoreboard.
 *
 * WHAT OM ASKED FOR, AND WHY IT IS THESE FIVE NUMBERS
 * ---------------------------------------------------
 * "If there is an admin panel where I or you can look at how these guys are
 * following up with different individuals, that'll be really helpful." The
 * three KPIs Dev named were outreach done, follow-ups, meetings booked — plus,
 * in Om's words, "a risk metric" for the leads someone was supposed to follow
 * up with and never did. So: done, scheduled, done-on-time, booked, and what is
 * rotting.
 *
 * EVERY NUMBER HAS TO BE ATTRIBUTABLE, AND ONE OF THEM ISN'T YET
 * -------------------------------------------------------------
 * Measured 2026-09-27 over the previous 13 days, team-wide:
 *   - outreach logged: 100 rows (Siddhant 74, unattributed 11, Gaurav 9, Aditya 6)
 *   - meetings booked: readable from crm_lead_stage_events, every one attributed
 *   - follow-ups marked done: THREE, and 15 of 556 live leads have a date at all
 * So `followUpsDone` will read ~0 for everyone at first. That is the honest
 * number and it is the point — the guardrail exists to create the behaviour, and
 * a scoreboard that flattered it would hide exactly what Dev wants to see.
 *
 * TEAM TOTALS SUM ONLY THE LISTED ROWS. Same rule as the weekly digest: if a
 * person is not on the board, their work is not in the total, so the total can
 * never silently disagree with the rows above it.
 */

import { supabase } from '../supabase'
import { istDateStr, fetchAllRows } from './core'
// istWeekStart lives in dateUtils, NOT core — core only re-exports istDateStr.
// Importing it from core lints clean and is undefined at runtime.
import { istWeekStart } from '../dateUtils'
import { isStaleBreach, isMissingInfo, STALE_BREACH_DAYS } from '../leadHealth'
import { isMeetingBooked, isMeetingHeld } from '../meetingCounts'

// The retired-stage map and both meeting definitions live in
// src/lib/meetingCounts.js, shared with api/weekly-digest.js. Dev, 27 Sept:
// "Sage and CRM should not at all disagree with meetings." They did — the digest
// counted activity_type IN ('call','meeting') and called the total "meetings",
// while this counted stage events into meeting_booked. Both numbers are worth
// having; using one word for them was the bug.

/** Monday-to-today IST, the same week boundary the funnel and streaks use. */
export function currentWeekBounds(today = istDateStr()) {
  return { start: istWeekStart(today), end: today }
}

/**
 * Per-person numbers for a week, plus the rot that has no week.
 *
 * `start`/`end` are IST date strings (inclusive). The breach counts are
 * deliberately NOT windowed: a lead 60 days untouched is a problem today
 * regardless of which week you are looking at, and hiding it behind a date
 * filter is how it stayed invisible.
 */
export async function getScoreboard({ start, end, people = [] } = {}) {
  const bounds = (start && end) ? { start, end } : currentWeekBounds()
  const today = istDateStr()

  const [outreach, stageEvents, activities, leads, transcripts] = await Promise.all([
    // 1. Outreach done — one row per touch, phone_call included (a dial counts).
    fetchAllRows(() => supabase
      .from('crm_outreach_log')
      .select('logged_by, outreach_date, outreach_type, status')
      .gte('outreach_date', bounds.start)
      .lte('outreach_date', bounds.end)
      .order('id')),

    // 2. Meetings booked — the audit trail, not the current stage. A lead that
    //    was booked and has since moved on still counts for the week it booked.
    fetchAllRows(() => supabase
      .from('crm_lead_stage_events')
      .select('to_stage, changed_by, changed_at')
      .gte('changed_at', `${bounds.start}T00:00:00+05:30`)
      .lte('changed_at', `${bounds.end}T23:59:59+05:30`)
      .order('id')),

    // 3. Follow-ups done — logFollowUpTouch writes an activity and retires the
    //    reminder. The activity is the only durable evidence it happened.
    fetchAllRows(() => supabase
      .from('crm_lead_activities')
      .select('logged_by, activity_date, activity_type, notes')
      .gte('activity_date', bounds.start)
      .lte('activity_date', bounds.end)
      .order('id')),

    // 4. The live book, for scheduled counts and the breach counts.
    fetchAllRows(() => supabase
      .from('crm_leads')
      .select('id, stage, assigned_to, created_by, is_archived, last_activity_date, created_at, next_follow_up_date, lead_type, buying_timeline, lead_channel, investment_thesis, prior_acquisitions, engagement_model')
      .eq('is_archived', false)
      .order('id')),

    // 5. Which leads have a transcript at all — one column, deduped client-side.
    fetchAllRows(() => supabase
      .from('crm_transcripts')
      .select('lead_id')
      .order('id')),
  ])

  const withTranscript = new Set((transcripts || []).map(t => t.lead_id))

  const blank = () => ({
    outreachDone: 0,
    dials: 0,
    replies: 0,
    meetingsBooked: 0,
    meetingsHeld: 0,
    followUpsScheduled: 0,
    followUpsDone: 0,
    staleBreaches: 0,
    missingInfo: 0,
    needsTranscript: 0,
    liveLeads: 0,
  })

  const rows = new Map()
  // Seeded from `people` so someone who did nothing shows a zero row rather
  // than vanishing — the digest rule ("everyone, zeros included", Dev July
  // 2026): a person missing from the board reads as fine, and a zero does not.
  for (const p of people) rows.set(p.id, { personId: p.id, name: p.name, ...blank() })
  const bucket = (id) => {
    if (id == null) return null
    if (!rows.has(id)) rows.set(id, { personId: id, name: null, ...blank() })
    return rows.get(id)
  }

  let unattributedOutreach = 0
  for (const r of outreach || []) {
    const b = bucket(r.logged_by)
    if (!b) { unattributedOutreach++; continue }
    b.outreachDone++
    if (r.outreach_type === 'phone_call') b.dials++
    if (r.status === 'replied') b.replies++
  }

  for (const e of stageEvents || []) {
    if (!isMeetingBooked(e)) continue
    const b = bucket(e.changed_by)
    if (b) b.meetingsBooked++
  }

  // A follow-up touch is an activity whose note logFollowUpTouch wrote. Matching
  // on the note is ugly but it is the only marker that exists; the alternative
  // is counting every note, and 214 of the last 416 were auto-generated "Lead
  // created in CRM" rows, which would turn an import into a week of hard work.
  for (const a of activities || []) {
    // Meetings HELD — the same definition the Monday Sage digest uses, so the
    // two reports agree by construction rather than by coincidence.
    if (isMeetingHeld(a)) {
      const held = bucket(a.logged_by)
      if (held) held.meetingsHeld++
    }
    if (!/^Followed up/.test(a.notes || '')) continue
    const b = bucket(a.logged_by)
    if (b) b.followUpsDone++
  }

  for (const lead of leads || []) {
    // Owner, with the created_by fallback — the same rule leadOwnerId uses, so
    // a lead cannot be counted against nobody while sitting in someone's book.
    const b = bucket(lead.assigned_to ?? lead.created_by)
    if (!b) continue
    b.liveLeads++
    if (lead.next_follow_up_date && lead.next_follow_up_date >= today) b.followUpsScheduled++
    if (isStaleBreach(lead, { today })) b.staleBreaches++
    if (isMissingInfo(lead)) b.missingInfo++
    const reachedMeeting = ['meeting_booked', 'warm_active', 'client'].includes(lead.stage)
    if (reachedMeeting && !withTranscript.has(lead.id)) b.needsTranscript++
  }

  const listed = [...rows.values()].sort((a, b) =>
    (b.outreachDone + b.meetingsBooked + b.meetingsHeld) - (a.outreachDone + a.meetingsBooked + a.meetingsHeld) ||
    String(a.name ?? '').localeCompare(String(b.name ?? '')))

  const team = listed.reduce((acc, r) => {
    for (const k of Object.keys(blank())) acc[k] += r[k]
    return acc
  }, blank())

  return {
    bounds,
    rows: listed,
    team,
    unattributedOutreach,
    staleBreachDays: STALE_BREACH_DAYS,
  }
}
