// Guardrails for the per-person scoreboard.
//
// This is the panel Om asked for — "somewhere we can see that these guys are
// actually following up" — so every number on it gets read as a judgement about
// a person. The ways it can be quietly wrong are therefore expensive:
//
//  1. RETIRED STAGE NAMES. crm_lead_stage_events is append-only and still holds
//     `cold_outreach` (27 events) and `warm_lead` (2) from before the Sept 2026
//     merge. Group by stage without mapping them and the history silently
//     under-counts.
//  2. EVERYONE, ZEROS INCLUDED. Dev's July 2026 rule for the digest applies
//     here for the same reason: a person missing from the board reads as fine,
//     a zero does not. The people doing nothing are the point of the board.
//  3. THE TEAM TOTAL SUMS ONLY THE LISTED ROWS, so it can never disagree with
//     the rows printed above it.
//  4. UNATTRIBUTED WORK IS REPORTED, NOT DROPPED. 11 of the last 100 outreach
//     rows had no logged_by. Silently discarding them makes the team total lie.
//  5. OWNERSHIP USES THE created_by FALLBACK, so a lead cannot be counted
//     against nobody while sitting in somebody's book.
//  6. A FOLLOW-UP IS NOT ANY NOTE. 214 of the last 416 activities were
//     auto-generated "Lead created in CRM" rows; counting notes would turn one
//     import into a week of hard work.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))

vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { getScoreboard, currentWeekBounds } = await import('../src/lib/api/scoreboard.js')

const PEOPLE = [{ id: 1, name: 'Dev' }, { id: 2, name: 'Aum' }, { id: 3, name: 'Quiet' }]

/** Serve one canned table set; everything unlisted comes back empty. */
function serving({ outreach = [], events = [], activities = [], leads = [], transcripts = [] }) {
  return (op) => {
    if (op.table === 'crm_outreach_log') return { data: outreach }
    if (op.table === 'crm_lead_stage_events') return { data: events }
    if (op.table === 'crm_lead_activities') return { data: activities }
    if (op.table === 'crm_leads') return { data: leads }
    if (op.table === 'crm_transcripts') return { data: transcripts }
    return { data: [] }
  }
}

const run = (tables, opts = {}) => {
  h.db = fakeSupabase(serving(tables))
  return getScoreboard({ start: '2026-09-21', end: '2026-09-27', people: PEOPLE, ...opts })
}
const rowFor = (board, id) => board.rows.find(r => r.personId === id)

beforeEach(() => { vi.restoreAllMocks() })

describe('week bounds', () => {
  it('starts the week on the IST Monday', () => {
    expect(currentWeekBounds('2026-09-27')).toEqual({ start: '2026-09-21', end: '2026-09-27' })
  })
})

describe('everyone appears, zeros included', () => {
  it('lists a person who did nothing at all', async () => {
    const board = await run({ outreach: [{ logged_by: 1, outreach_type: 'linkedin_message' }] })

    expect(board.rows).toHaveLength(3)
    expect(rowFor(board, 3)).toMatchObject({ name: 'Quiet', outreachDone: 0, meetingsBooked: 0 })
  })

  it('still lists someone who logged work but is not on the roster', async () => {
    const board = await run({ outreach: [{ logged_by: 99, outreach_type: 'email' }] })
    expect(rowFor(board, 99)).toMatchObject({ outreachDone: 1, name: null })
  })
})

describe('meetings booked', () => {
  it('counts a stage event into meeting_booked, attributed to who moved it', async () => {
    const board = await run({
      events: [
        { to_stage: 'meeting_booked', changed_by: 2 },
        { to_stage: 'responded', changed_by: 2 },
      ]
    })
    expect(rowFor(board, 2).meetingsBooked).toBe(1)
  })

  it('maps retired stage names rather than dropping them', async () => {
    // Pre-Sept-2026 events. cold_outreach/warm_lead are NOT meeting_booked and
    // must not be counted as one, but they must not blow up the mapping either.
    const board = await run({
      events: [
        { to_stage: 'cold_outreach', changed_by: 1 },
        { to_stage: 'warm_lead', changed_by: 1 },
        { to_stage: 'meeting_booked', changed_by: 1 },
      ]
    })
    expect(rowFor(board, 1).meetingsBooked).toBe(1)
  })
})

describe('follow-ups', () => {
  it('counts a follow-up touch, not every note', async () => {
    const board = await run({
      activities: [
        { logged_by: 1, notes: 'Followed up — asked about the thesis' },
        { logged_by: 1, notes: 'Lead created in CRM' },
        { logged_by: 1, notes: 'Moved to responded (auto — outreach reply)' },
      ]
    })
    expect(rowFor(board, 1).followUpsDone).toBe(1)
  })

  it('counts a scheduled follow-up only when it is today or later', async () => {
    const board = await run({
      leads: [
        { id: 1, stage: 'responded', assigned_to: 1, next_follow_up_date: '2099-01-01', last_activity_date: '2026-09-26' },
        { id: 2, stage: 'responded', assigned_to: 1, next_follow_up_date: '2026-01-01', last_activity_date: '2026-09-26' },
      ]
    })
    expect(rowFor(board, 1).followUpsScheduled).toBe(1)
  })
})

describe('the breach counts', () => {
  it('counts a stale lead against its owner', async () => {
    const board = await run({
      leads: [{ id: 1, stage: 'responded', assigned_to: 2, last_activity_date: '2026-06-01' }]
    })
    expect(rowFor(board, 2).staleBreaches).toBe(1)
  })

  it('falls back to created_by so no lead is counted against nobody', async () => {
    const board = await run({
      leads: [{ id: 1, stage: 'responded', assigned_to: null, created_by: 3, last_activity_date: '2026-06-01' }]
    })
    expect(rowFor(board, 3).staleBreaches).toBe(1)
    expect(rowFor(board, 3).liveLeads).toBe(1)
  })

  it('counts a meeting-stage lead with no transcript', async () => {
    const board = await run({
      leads: [
        { id: 7, stage: 'meeting_booked', assigned_to: 1, last_activity_date: '2026-09-26' },
        { id: 8, stage: 'meeting_booked', assigned_to: 1, last_activity_date: '2026-09-26' },
      ],
      transcripts: [{ lead_id: 8 }]
    })
    expect(rowFor(board, 1).needsTranscript).toBe(1)
  })

  it('does not ask a cold lead for a transcript or for its info', async () => {
    const board = await run({
      leads: [{ id: 9, stage: 'outreach', assigned_to: 1, last_activity_date: '2026-09-26' }]
    })
    expect(rowFor(board, 1)).toMatchObject({ needsTranscript: 0, missingInfo: 0 })
  })

  it('counts missing required info on an engaged lead', async () => {
    const board = await run({
      leads: [{ id: 10, stage: 'warm_active', assigned_to: 1, last_activity_date: '2026-09-26', lead_type: 'PE Firm' }]
    })
    expect(rowFor(board, 1).missingInfo).toBe(1)
  })
})

describe('honesty of the totals', () => {
  it('sums the team from the listed rows only', async () => {
    const board = await run({
      outreach: [{ logged_by: 1 }, { logged_by: 2 }, { logged_by: 2 }],
      events: [{ to_stage: 'meeting_booked', changed_by: 1 }]
    })
    const summed = board.rows.reduce((n, r) => n + r.outreachDone, 0)
    expect(board.team.outreachDone).toBe(summed)
    expect(board.team.outreachDone).toBe(3)
    expect(board.team.meetingsBooked).toBe(1)
  })

  it('reports outreach with no logged_by instead of silently dropping it', async () => {
    const board = await run({ outreach: [{ logged_by: null }, { logged_by: 1 }] })

    expect(board.unattributedOutreach).toBe(1)
    expect(board.team.outreachDone).toBe(1) // not attributed to anyone, not invented
  })

  it('separates dials from total outreach — a dial counts, but it is its own number', async () => {
    const board = await run({
      outreach: [
        { logged_by: 1, outreach_type: 'phone_call' },
        { logged_by: 1, outreach_type: 'linkedin_message' },
      ]
    })
    expect(rowFor(board, 1)).toMatchObject({ outreachDone: 2, dials: 1 })
  })

  it('reads archived leads out of the book entirely', async () => {
    h.db = fakeSupabase(serving({ leads: [] }))
    await getScoreboard({ start: '2026-09-21', end: '2026-09-27', people: PEOPLE })

    const leadQ = h.db.opsFor('crm_leads', 'select')[0]
    expect(leadQ.filters.some(f => f[0] === 'eq' && f[1] === 'is_archived' && f[2] === false)).toBe(true)
  })
})
