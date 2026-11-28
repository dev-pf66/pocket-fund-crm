// Typed updates + snoozes that actually hold (Dev, 2026-11-28: "I can type in
// 'reach out in the start of the new year' and then it pops up on Today in
// Jan"). Pins:
//   1. a lead with a deliberately set future date is OUT of the Today queue —
//      before this, the queue ignored next_follow_up_date, so a snooze lasted
//      until the next page load and a January reminder nagged every morning;
//   2. the automatic 30-day check-in does NOT hide a lead (safety net, not a
//      promise);
//   3. snoozing drops the default note so the snooze counts as a promise;
//   4. an update on a due follow-up counts as a follow-up done;
//   5. Claude's answer is validated — a past or malformed date becomes null.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { cacheClear } = await import('../src/lib/api/core.js')
const { getTodayQueue, hasFuturePromise } = await import('../src/lib/api/today.js')
const { snoozeNoteFor, updateNote } = await import('../src/lib/api/followups.js')
const { isFollowUpDoneNote } = await import('../src/lib/api/scoreboard.js')
const { DEFAULT_FOLLOW_UP_NOTE } = await import('../src/lib/followUpPolicy.js')
const { cleanReminderAnswer } = await import('../api/_reminder-ai.js')
const { istToday, istAddDays } = await import('../src/lib/dateUtils.js')

const SETTINGS = { id: 1, cold_outreach_threshold: 3, warm_lead_threshold: 7, active_conversation_threshold: 14 }
const TODAY = istToday()
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString()

function db(leads) {
  return fakeSupabase(op => {
    if (op.table === 'crm_lead_cover') return { data: [] }
    if (op.table === 'crm_settings') return { data: SETTINGS }
    if (op.table === 'crm_leads') return { data: leads }
    return { data: [] }
  })
}

beforeEach(() => cacheClear())

describe('Today queue respects a promised date', () => {
  const base = { stage: 'responded', assigned_to: 1, is_archived: false, last_activity_date: daysAgo(2), created_at: daysAgo(30) }

  it('hides a lead someone pushed to January; keeps one on the automatic check-in', async () => {
    h.db = db([
      { ...base, id: 1, name: 'promised', next_follow_up_date: istAddDays(TODAY, 40), follow_up_note: 'start of the new year' },
      { ...base, id: 2, name: 'safety net', next_follow_up_date: istAddDays(TODAY, 28), follow_up_note: DEFAULT_FOLLOW_UP_NOTE },
      { ...base, id: 3, name: 'no reminder', next_follow_up_date: null },
      { ...base, id: 4, name: 'due today', next_follow_up_date: TODAY, follow_up_note: 'call back' }
    ])
    const { leads } = await getTodayQueue(1)
    expect(leads.map(l => l.name).sort()).toEqual(['due today', 'no reminder', 'safety net'])
  })

  it('hasFuturePromise: future + not the default note', () => {
    expect(hasFuturePromise({ next_follow_up_date: istAddDays(TODAY, 1), follow_up_note: null }, TODAY)).toBe(true)
    expect(hasFuturePromise({ next_follow_up_date: istAddDays(TODAY, 1), follow_up_note: DEFAULT_FOLLOW_UP_NOTE }, TODAY)).toBe(false)
    expect(hasFuturePromise({ next_follow_up_date: TODAY, follow_up_note: 'x' }, TODAY)).toBe(false)
  })
})

describe('snooze note', () => {
  it('drops the automatic check-in note, keeps a typed one', () => {
    expect(snoozeNoteFor({ follow_up_note: DEFAULT_FOLLOW_UP_NOTE })).toBe(null)
    expect(snoozeNoteFor({ follow_up_note: 'ask about Q3 board' })).toBe('ask about Q3 board')
    expect(snoozeNoteFor({})).toBe(null)
  })
})

describe('updateNote', () => {
  it('an update on a due follow-up is a follow-up done; otherwise a plain Update', () => {
    const due = updateNote({ next_follow_up_date: '2026-11-20' }, 'spoke, new year', {}, '2026-11-28')
    const early = updateNote({ next_follow_up_date: '2026-12-20' }, 'spoke, new year', {}, '2026-11-28')
    const fromFollowUps = updateNote({}, 'spoke', { followUp: true }, '2026-11-28')
    expect(isFollowUpDoneNote(due)).toBe(true)
    expect(isFollowUpDoneNote(fromFollowUps)).toBe(true)
    expect(early).toBe('Update — spoke, new year')
    expect(isFollowUpDoneNote(early)).toBe(false)
  })
})

describe('cleanReminderAnswer (Claude fallback)', () => {
  it('accepts a future ISO date, rejects past/malformed/garbage', () => {
    expect(cleanReminderAnswer('{"date":"2027-11-09","rule":"week after Diwali"}', '2026-11-28'))
      .toEqual({ date: '2027-11-09', rule: 'week after Diwali' })
    expect(cleanReminderAnswer('```json\n{"date":"2027-01-04","rule":"x"}\n```', '2026-11-28').date).toBe('2027-01-04')
    expect(cleanReminderAnswer('{"date":"2026-11-01","rule":"x"}', '2026-11-28').date).toBe(null)
    expect(cleanReminderAnswer('{"date":"Jan 4","rule":"x"}', '2026-11-28').date).toBe(null)
    expect(cleanReminderAnswer('{"date":null,"rule":"no time given"}', '2026-11-28').date).toBe(null)
    expect(cleanReminderAnswer('sorry, I cannot', '2026-11-28')).toEqual({ date: null, rule: '' })
  })
})
