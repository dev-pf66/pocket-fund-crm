// Guardrail: Sage and the CRM must report the same meetings.
//
// Dev, 27 Sept 2026: "Sage and CRM should not at all disagree with meetings.
// That should not be the case." They did. Three numbers were in play:
//
//   1. The Monday Sage digest counted `activity_type IN ('call','meeting')` and
//      printed the total under the word "meetings" — so a logged phone call was
//      reported as a meeting in the first line Dev reads on a Monday.
//   2. That activity is auto-logged when a lead LEAVES meeting_booked, because
//      meeting_booked means "agreed to meet", not "met". So it is a meeting HELD.
//   3. The CRM scoreboard counted stage events INTO meeting_booked — a meeting
//      BOOKED, which may not have happened.
//
// Both 2 and 3 are worth knowing; using one word for them was the bug. So: one
// shared module defines both, the digest and the scoreboard import it, and
// neither says "meetings" without saying which.
//
// The digest's own comment claimed it counted leads "entering meeting_booked",
// which was wrong in both directions — that stale comment is how the drift
// survived review.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  MEETING_HELD_ACTIVITY_TYPES, MEETING_BOOKED_STAGE,
  isMeetingHeld, isMeetingBooked, canonicalStage
} from '../src/lib/meetingCounts.js'

describe('what counts as a meeting', () => {
  it('a meeting activity is a meeting held', () => {
    expect(isMeetingHeld({ activity_type: 'meeting' })).toBe(true)
  })

  it('A CALL IS NOT A MEETING — this is the bug that was in the Sage digest', () => {
    expect(isMeetingHeld({ activity_type: 'call' })).toBe(false)
    expect(MEETING_HELD_ACTIVITY_TYPES).not.toContain('call')
  })

  it('nor is a note, an email or a proposal', () => {
    for (const t of ['note', 'email', 'proposal_sent', undefined, null]) {
      expect(isMeetingHeld({ activity_type: t })).toBe(false)
    }
    expect(isMeetingHeld(null)).toBe(false)
  })

  it('a stage event into meeting_booked is a meeting booked', () => {
    expect(isMeetingBooked({ to_stage: MEETING_BOOKED_STAGE })).toBe(true)
    expect(isMeetingBooked({ to_stage: 'responded' })).toBe(false)
    expect(isMeetingBooked(null)).toBe(false)
  })

  it('maps stage names retired by the Sept 2026 restructure', () => {
    // crm_lead_stage_events is append-only and still holds these.
    expect(canonicalStage('cold_outreach')).toBe('outreach')
    expect(canonicalStage('new_lead')).toBe('outreach')
    expect(canonicalStage('warm_lead')).toBe('warm_active')
    expect(canonicalStage('active_conversation')).toBe('warm_active')
  })

  it('leaves a live stage name alone', () => {
    for (const s of ['outreach', 'responded', 'meeting_booked', 'warm_active', 'client', 'passed']) {
      expect(canonicalStage(s)).toBe(s)
    }
  })

  it('does not count a retired stage as a booking', () => {
    expect(isMeetingBooked({ to_stage: 'warm_lead' })).toBe(false)
    expect(isMeetingBooked({ to_stage: 'cold_outreach' })).toBe(false)
  })
})

// ============================================================================
// THE SAGE DIGEST SAYS WHICH MEETING IT MEANS
// ============================================================================

const { composeDigest } = await import('../api/weekly-digest.js')

const PEOPLE = [{ id: 'aum', name: 'Aum', is_archived: false }]
// composeDigest windows on the IST week; anchor on a fixed Monday-to-Sunday.
const TODAY = '2026-09-28'   // Monday — digest reports the week just ended
const IN_WEEK = '2026-09-23'

describe('the digest labels meetings as HELD', () => {
  it('says "meetings held", never a bare "meetings"', () => {
    const d = composeDigest({
      people: PEOPLE,
      outreach: [],
      meetings: [{ logged_by: 'aum', activity_date: `${IN_WEEK}T09:30:00Z` }],
      demos: [],
      today: TODAY
    })
    expect(d.body).toMatch(/meetings held/)
    // A bare "N meetings ·" would mean the ambiguity is back.
    expect(d.body).not.toMatch(/\d+ meetings [^h]/)
  })
})

// ============================================================================
// THE SCOREBOARD REPORTS BOTH, FROM THE SAME RULE
// ============================================================================

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))
const { fakeSupabase } = await import('./helpers/fake-supabase.js')
const { getScoreboard } = await import('../src/lib/api/scoreboard.js')

beforeEach(() => { vi.restoreAllMocks() })

describe('the scoreboard separates booked from held', () => {
  it('counts them independently and does not let a call into either', async () => {
    h.db = fakeSupabase((op) => {
      if (op.table === 'crm_lead_stage_events') {
        return { data: [{ to_stage: 'meeting_booked', changed_by: 1 }] }
      }
      if (op.table === 'crm_lead_activities') {
        return { data: [
          { logged_by: 1, activity_type: 'meeting', notes: '' },
          { logged_by: 1, activity_type: 'call', notes: '' },   // must not count
        ] }
      }
      return { data: [] }
    })

    const board = await getScoreboard({
      start: '2026-09-21', end: '2026-09-27', people: [{ id: 1, name: 'Dev' }]
    })
    const row = board.rows.find(r => r.personId === 1)

    expect(row.meetingsBooked).toBe(1)
    expect(row.meetingsHeld).toBe(1)   // the meeting, not the call
  })
})
