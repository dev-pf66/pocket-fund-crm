// Guardrails for cold call tracking.
//
// Calls share crm_outreach_log with email and LinkedIn so that dials count
// toward the daily goal for free (Dev's call, Sept 2026). That sharing is
// exactly what makes the machinery trap-prone, and these pin the four ways it
// silently goes wrong:
//
//  1. The outcome vocabulary drifting away from the CHECK constraint — every
//     insert of the new value would fail in prod and nowhere else.
//  2. A gatekeeper counted as a conversation. It's a pickup, not a
//     conversation, and folding them together makes the funnel flatter itself
//     by exactly the amount that matters.
//  3. statusForOutcome going non-total. Every call row carries a legacy
//     `status` so reply rate / the digest / the pipeline filter keep reading
//     one column; an unmapped outcome writes a status nothing understands.
//  4. replied_at stamped on a dial that rang out — which would spike "replies
//     this week" with calls nobody answered.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fakeSupabase } from './helpers/fake-supabase.js'
import {
  CALL_OUTCOMES, CALL_OUTCOME_VALUES, statusForOutcome, isPickup,
  isConversation, isPositive, summarizeCalls, rate, fmtRate, fmtDuration
} from '../src/lib/callOutcomes.js'

const h = vi.hoisted(() => ({ db: null }))

vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { logCall, weekdaysBetween, getCallQueue, istHourOf } = await import('../src/lib/api/calls.js')

const LEGAL_STATUSES = ['sent', 'replied', 'no_response', 'bounced']

beforeEach(() => { vi.restoreAllMocks() })

// ---------------------------------------------------------------------------

describe('the outcome vocabulary', () => {
  it('matches the CHECK constraint in migration 045 exactly', () => {
    const sql = readFileSync(new URL('../migrations/045_cold-calls.sql', import.meta.url), 'utf8')
    const check = sql.match(/call_outcome IN \(([\s\S]*?)\)\);/)
    expect(check, 'the call_outcome CHECK constraint should still be in 045').toBeTruthy()
    const inSql = [...check[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1])
    // Set comparison: order in the SQL is cosmetic, membership is not. A value
    // in JS but not in SQL fails every insert of it, in prod only.
    expect(new Set(inSql)).toEqual(new Set(CALL_OUTCOME_VALUES))
  })

  it('has no duplicate values', () => {
    expect(new Set(CALL_OUTCOME_VALUES).size).toBe(CALL_OUTCOME_VALUES.length)
  })

  it('maps every outcome onto a legal legacy status', () => {
    for (const value of CALL_OUTCOME_VALUES) {
      expect(LEGAL_STATUSES, `${value} mapped to an unknown status`).toContain(statusForOutcome(value))
    }
  })

  it('treats an unknown outcome as no response rather than throwing', () => {
    // A row imported from somewhere else must not take the page down.
    expect(statusForOutcome('something_new')).toBe('no_response')
    expect(statusForOutcome(null)).toBe('no_response')
  })
})

describe('pickup vs conversation', () => {
  it('counts a gatekeeper as a pickup but NOT a conversation', () => {
    expect(isPickup('gatekeeper')).toBe(true)
    expect(isConversation('gatekeeper')).toBe(false)
  })

  it('counts a wrong number as a pickup but NOT a conversation', () => {
    expect(isPickup('wrong_person')).toBe(true)
    expect(isConversation('wrong_person')).toBe(false)
  })

  it('counts a flat no as a real conversation', () => {
    // They answered and engaged. Excluding it would quietly inflate every
    // downstream rate by shrinking the denominator.
    expect(isConversation('not_interested')).toBe(true)
    expect(isPositive('not_interested')).toBe(false)
    expect(statusForOutcome('not_interested')).toBe('replied')
  })

  it('never marks an unanswered dial as a pickup', () => {
    for (const value of ['no_answer', 'voicemail', 'bad_number']) {
      expect(isPickup(value), value).toBe(false)
      expect(isConversation(value), value).toBe(false)
    }
  })

  it('every conversation is also a pickup', () => {
    for (const o of CALL_OUTCOMES) {
      if (o.conversation) expect(o.pickup, `${o.value} is a conversation but not a pickup`).toBe(true)
      if (o.positive) expect(o.conversation, `${o.value} is positive but not a conversation`).toBe(true)
    }
  })

  it('routes a dead number to bounced, like an undeliverable email', () => {
    expect(statusForOutcome('bad_number')).toBe('bounced')
  })
})

describe('summarizeCalls', () => {
  const rows = [
    { call_outcome: 'no_answer' },
    { call_outcome: 'no_answer' },
    { call_outcome: 'voicemail' },
    { call_outcome: 'gatekeeper' },
    { call_outcome: 'not_interested', call_duration_seconds: 60 },
    { call_outcome: 'interested', call_duration_seconds: 180 },
    { call_outcome: 'meeting_booked', call_duration_seconds: 300 },
  ]

  it('builds the funnel with the right denominators at each level', () => {
    const s = summarizeCalls(rows)
    expect(s.dials).toBe(7)
    expect(s.pickups).toBe(4)        // gatekeeper + the three conversations
    expect(s.conversations).toBe(3)  // gatekeeper excluded
    expect(s.positive).toBe(2)
    expect(s.meetings).toBe(1)
    // Each rate is against the level ABOVE it, not against dials.
    expect(s.pickupRate).toBeCloseTo((4 / 7) * 100)
    expect(s.conversationRate).toBeCloseTo((3 / 4) * 100)
    expect(s.meetingRate).toBeCloseTo((1 / 3) * 100)
    expect(s.dialsPerMeeting).toBeCloseTo(7)
  })

  it('averages talk time over calls that HAVE a duration, not over all dials', () => {
    // Dividing by 7 instead of 3 would report a 3-minute call as 77 seconds.
    expect(summarizeCalls(rows).avgTalkSeconds).toBeCloseTo(540 / 3)
  })

  it('returns null rates rather than 0 when there is nothing to divide by', () => {
    // "0% pickup rate" on no data reads as a crisis; "—" reads as no data.
    const s = summarizeCalls([])
    expect(s.dials).toBe(0)
    expect(s.pickupRate).toBeNull()
    expect(s.conversationRate).toBeNull()
    expect(s.dialsPerMeeting).toBeNull()
    expect(s.avgTalkSeconds).toBeNull()
    expect(fmtRate(s.pickupRate)).toBe('—')
    expect(fmtDuration(s.avgTalkSeconds)).toBe('—')
  })

  it('lets an explicit connected flag override the outcome', () => {
    // A provider webhook knows answered/not from the carrier; the caller's
    // own tap can be sloppier, and the carrier wins.
    const s = summarizeCalls([
      { call_outcome: 'no_answer', connected: true },
      { call_outcome: 'interested', connected: false },
    ])
    expect(s.pickups).toBe(1)
    // ...but the conversation count still reads the outcome, which is the
    // only thing that knows WHO was reached.
    expect(s.conversations).toBe(1)
  })

  it('counts a row with no outcome as a dial and nothing more', () => {
    const s = summarizeCalls([{ call_outcome: null }])
    expect(s.dials).toBe(1)
    expect(s.pickups).toBe(0)
    expect(s.conversations).toBe(0)
  })

  it('rate() never divides by zero', () => {
    expect(rate(5, 0)).toBeNull()
    expect(rate(0, 0)).toBeNull()
    expect(rate(1, 4)).toBe(25)
  })
})

// ---------------------------------------------------------------------------

function callDb(lead = { id: 7, stage: 'cold_outreach' }) {
  return fakeSupabase((op) => {
    if (op.table === 'crm_outreach_log' && op.type === 'insert') {
      return { data: { id: 99, ...op.payload[0] } }
    }
    if (op.table === 'crm_outreach_log') return { data: [], count: 3 }
    if (op.table === 'crm_leads' && op.type === 'select') return { data: lead }
    if (op.table === 'crm_leads' && op.type === 'update') {
      return { data: op.single ? { ...lead, ...op.payload } : [{ id: lead.id }] }
    }
    return { data: [] }
  })
}

const insertedCall = () => h.db.opsFor('crm_outreach_log', 'insert')[0].payload[0]
const leadUpdates = () => h.db.opsFor('crm_leads', 'update').map(o => o.payload)

describe('logCall', () => {
  it('writes a phone_call row with status and connected derived, not trusted', () => {
    h.db = callDb()
    return logCall({
      lead_id: 7, lead_name: 'Ana', phone_number: '+15551234',
      call_outcome: 'gatekeeper',
      // A caller cannot hand in a status that disagrees with the outcome.
      status: 'replied',
    }, 3, 'Dev').then(() => {
      const row = insertedCall()
      expect(row.outreach_type).toBe('phone_call')
      expect(row.status).toBe('no_response')  // gatekeeper is not a reply
      expect(row.connected).toBe(true)        // ...but somebody did pick up
      expect(row.call_provider).toBe('callhippo')
      expect(row.logged_by).toBe(3)
    })
  })

  it('does NOT stamp replied_at on a dial that rang out', async () => {
    h.db = callDb()
    await logCall({ lead_id: 7, lead_name: 'Ana', call_outcome: 'no_answer' }, 3)
    expect(insertedCall().replied_at).toBeUndefined()
    expect(insertedCall().status).toBe('no_response')
  })

  it('stamps replied_at when we actually reached them', async () => {
    h.db = callDb()
    await logCall({ lead_id: 7, lead_name: 'Ana', call_outcome: 'interested' }, 3)
    const row = insertedCall()
    expect(row.status).toBe('replied')
    expect(row.replied_at).toBeTruthy()
    // The reply is stamped at the time of the CALL, not at the send date.
    expect(row.replied_at).toBe(row.called_at)
  })

  it('records the attempt number from the contact history', async () => {
    h.db = callDb()  // responder reports 3 prior dials
    await logCall({ lead_id: 7, lead_name: 'Ana', call_outcome: 'no_answer' }, 3)
    expect(insertedCall().attempt_number).toBe(4)
  })

  it('buckets the dial onto its IST calendar day so it counts toward the goal', async () => {
    h.db = callDb()
    // 23:00 UTC on the 1st is 04:30 IST on the 2nd.
    await logCall({
      lead_id: 7, lead_name: 'Ana', call_outcome: 'no_answer',
      called_at: '2026-09-01T23:00:00.000Z',
    }, 3)
    expect(insertedCall().outreach_date).toBe('2026-09-02')
  })

  it('advances the lead to meeting_booked when a meeting is booked', async () => {
    h.db = callDb({ id: 7, stage: 'cold_outreach' })
    await logCall({ lead_id: 7, lead_name: 'Ana', call_outcome: 'meeting_booked' }, 3)
    expect(leadUpdates()).toContainEqual({ stage: 'meeting_booked' })
  })

  it('advances the lead to responded on any real conversation', async () => {
    h.db = callDb({ id: 7, stage: 'cold_outreach' })
    await logCall({ lead_id: 7, lead_name: 'Ana', call_outcome: 'not_interested' }, 3)
    expect(leadUpdates()).toContainEqual({ stage: 'responded' })
  })

  it('does NOT touch the pipeline on a dial nobody answered', async () => {
    h.db = callDb({ id: 7, stage: 'cold_outreach' })
    await logCall({ lead_id: 7, lead_name: 'Ana', call_outcome: 'no_answer' }, 3)
    expect(leadUpdates().some(u => 'stage' in u)).toBe(false)
  })

  it('flags the lead do_not_call when they ask not to be called again', async () => {
    h.db = callDb({ id: 7, stage: 'cold_outreach' })
    await logCall({ lead_id: 7, lead_name: 'Ana', call_outcome: 'do_not_call' }, 3)
    expect(leadUpdates()).toContainEqual({ do_not_call: true })
  })

  it('pushes a callback onto the lead as a follow-up date', async () => {
    h.db = callDb({ id: 7, stage: 'cold_outreach' })
    await logCall({
      lead_id: 7, lead_name: 'Ana', call_outcome: 'callback',
      callback_at: '2026-09-10T09:30:00.000Z', notes: 'Try after the board meeting',
    }, 3)
    const patch = leadUpdates().find(u => 'next_follow_up_date' in u)
    expect(patch.next_follow_up_date).toBe('2026-09-10')  // IST day of the callback
    expect(patch.follow_up_note).toBe('Try after the board meeting')
  })

  it('still saves the dial when a side effect fails', async () => {
    // The call happened. A failed pipeline sync must not surface mid-session
    // as "could not log the call" and cost the caller their place in the queue.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.db = fakeSupabase((op) => {
      if (op.table === 'crm_outreach_log' && op.type === 'insert') return { data: { id: 99, ...op.payload[0] } }
      if (op.table === 'crm_outreach_log') return { data: [], count: 0 }
      if (op.table === 'crm_leads') return { data: null, error: { message: 'RLS denied' } }
      return { data: [] }
    })
    const saved = await logCall({ lead_id: 7, lead_name: 'Ana', call_outcome: 'interested' }, 3)
    expect(saved.id).toBe(99)
  })
})

// ---------------------------------------------------------------------------

describe('weekdaysBetween', () => {
  it('excludes weekends — the consistency denominator', () => {
    // Mon 2026-09-07 .. Sun 2026-09-13 is 5 working days, not 7. Counting
    // calendar days made every caller look ~30% inconsistent by arithmetic.
    expect(weekdaysBetween('2026-09-07', '2026-09-13')).toBe(5)
  })

  it('counts a single weekday as one and a single Sunday as none', () => {
    expect(weekdaysBetween('2026-09-09', '2026-09-09')).toBe(1)
    expect(weekdaysBetween('2026-09-13', '2026-09-13')).toBe(0)
  })

  it('returns 0 for a reversed range instead of looping', () => {
    expect(weekdaysBetween('2026-09-13', '2026-09-07')).toBe(0)
  })
})

describe('istHourOf', () => {
  it('reads the IST clock hour, not UTC', () => {
    expect(istHourOf('2026-09-02T09:00:00.000Z')).toBe(14)  // 14:30 IST
    expect(istHourOf(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('getCallQueue', () => {
  const leads = [
    { id: 1, name: 'Never called', phone: '+1', do_not_call: false, stage: 'cold_outreach' },
    { id: 2, name: 'Called yesterday', phone: '+2', do_not_call: false, stage: 'cold_outreach' },
    { id: 3, name: 'Said no', phone: '+3', do_not_call: false, stage: 'cold_outreach' },
    { id: 4, name: 'Exhausted', phone: '+4', do_not_call: false, stage: 'cold_outreach' },
    { id: 5, name: 'Callback due', phone: '+5', do_not_call: false, stage: 'cold_outreach' },
  ]
  const history = [
    { lead_id: 2, called_at: '2026-09-01T10:00:00.000Z', call_outcome: 'no_answer' },
    { lead_id: 3, called_at: '2026-09-01T10:00:00.000Z', call_outcome: 'not_interested' },
    ...Array.from({ length: 6 }, (_, i) => ({
      lead_id: 4, called_at: `2026-08-0${i + 1}T10:00:00.000Z`, call_outcome: 'no_answer',
    })),
    { lead_id: 5, called_at: '2026-08-20T10:00:00.000Z', call_outcome: 'callback', callback_at: '2026-08-25T10:00:00.000Z' },
  ]

  beforeEach(() => {
    h.db = fakeSupabase((op) => {
      if (op.table === 'crm_leads') return { data: leads }
      if (op.table === 'crm_outreach_log') return { data: history }
      return { data: [] }
    })
  })

  it('puts a due callback at the front — the contact who already said yes', async () => {
    const { callbacks } = await getCallQueue(3)
    expect(callbacks.map(l => l.id)).toEqual([5])
  })

  it('offers a never-called lead before one dialled yesterday', async () => {
    const { queue } = await getCallQueue(3)
    expect(queue[0].id).toBe(1)
    expect(queue.map(l => l.id)).toContain(2)
  })

  it('parks a lead that already said no instead of re-offering it', async () => {
    const { queue, parked } = await getCallQueue(3)
    expect(queue.map(l => l.id)).not.toContain(3)
    expect(parked.map(l => l.id)).toEqual([3])
  })

  it('splits out a lead past the attempt ceiling rather than dropping it', async () => {
    const { queue, exhausted } = await getCallQueue(3)
    expect(queue.map(l => l.id)).not.toContain(4)
    expect(exhausted.map(l => l.id)).toEqual([4])
  })

  it('asks the database for callable leads only', async () => {
    await getCallQueue(3)
    const leadRead = h.db.opsFor('crm_leads', 'select')[0]
    // do_not_call is filtered in SQL, not client-side — a lead that asked not
    // to be called must never be loaded into the queue in the first place.
    expect(leadRead.filters).toContainEqual(['eq', 'do_not_call', false])
    expect(leadRead.filters).toContainEqual(['eq', 'assigned_to', 3])
  })

  it('returns empty buckets rather than throwing when nobody is callable', async () => {
    h.db = fakeSupabase(() => ({ data: [] }))
    const result = await getCallQueue(3)
    expect(result).toEqual({ queue: [], callbacks: [], exhausted: [], parked: [] })
  })
})
