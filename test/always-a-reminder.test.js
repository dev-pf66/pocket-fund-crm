// Guardrail: a live lead ALWAYS has a next follow-up reminder.
//
// Dev, 2026-11-16: "there should always be an automatic follow-up reminder,
// unless we are marking the lead as dead — whether that's 30 days, 90 days."
//
// Before this, five paths left a lead with no reminder at all, so it went
// silent until someone happened to look: Touched and Reached out cleared a
// one-off reminder, a cadence running out cleared it, and the Clear / ✕
// buttons cleared it on purpose. Touched also WIPED a reminder set weeks ahead
// ("circle back after their board meeting") on any unrelated early ping.
//
// Rules pinned here:
//   1. Completing a follow-up schedules the next one DEFAULT_FOLLOW_UP_DAYS out.
//   2. A touch on a lead with no reminder gives it one.
//   3. An EARLY touch leaves a future reminder exactly where it is.
//   4. A finished cadence falls back to the default, never to nothing.
//   5. Marking a lead dead is the ONE thing that ends its reminders.
//   6. "Still working" on the 30-day clock, with no date, on a lead with no
//      reminder, gets the default.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null, leadRow: { next_follow_up_date: null } }))
vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { DEFAULT_FOLLOW_UP_DAYS, DEFAULT_FOLLOW_UP_NOTE } = await import('../src/lib/followUpPolicy.js')
const { logFollowUpTouch, advanceFollowUpCadence } = await import('../src/lib/api/followups.js')
const { markLeadTouched, DEAD_LEAD_UPDATES } = await import('../src/lib/api/today.js')
const { disposeLead, updateLead, moveLead } = await import('../src/lib/api/leads.js')
const { getsDefaultReminder, isDefaultReminder, REMINDER_STAGES } = await import('../src/lib/followUpPolicy.js')

const TODAY = '2026-11-16'
const IN_30 = '2026-12-16'

// Every crm_leads update payload that touched the reminder columns.
const reminderWrites = () => h.db.ops
  .filter(o => o.table === 'crm_leads' && o.type === 'update' && o.payload && 'next_follow_up_date' in o.payload)
  .map(o => o.payload)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-16T06:00:00Z')) // 11:30 IST
  h.leadRow = { next_follow_up_date: null, stage: 'responded' }
  h.db = fakeSupabase(op => {
    if (op.table === 'crm_leads' && op.type === 'select') return { data: { id: 1, stage: 'responded', ...h.leadRow }, error: null }
    if (op.type === 'insert') { const row = { id: 99, ...(Array.isArray(op.payload) ? op.payload[0] : op.payload) }; return { data: op.single ? row : [row], error: null } }
    return { data: op.single ? { id: 1 } : [{ id: 1 }], error: null }
  })
})
afterEach(() => vi.useRealTimers())

describe('a live lead always has a next reminder', () => {
  it('the default is 30 days and the policy lives in one place', () => {
    expect(DEFAULT_FOLLOW_UP_DAYS).toBe(30)
    expect(DEFAULT_FOLLOW_UP_NOTE).toBe('30-day check-in')
  })

  it('Reached out on a due follow-up schedules the next one 30 days out', async () => {
    await logFollowUpTouch({ id: 1, stage: 'responded', next_follow_up_date: '2026-11-10' }, 7)
    const last = reminderWrites().at(-1)
    expect(last.next_follow_up_date).toBe(IN_30)
    expect(last.follow_up_note).toBe(DEFAULT_FOLLOW_UP_NOTE)
  })

  it('Touched on an overdue follow-up schedules the next one 30 days out', async () => {
    await markLeadTouched({ id: 1, stage: 'meeting_booked', next_follow_up_date: '2026-11-01' }, 7)
    expect(reminderWrites().at(-1).next_follow_up_date).toBe(IN_30)
  })

  it('Touched on a lead with no reminder gives it one', async () => {
    await markLeadTouched({ id: 1, stage: 'warm_active', next_follow_up_date: null }, 7)
    expect(reminderWrites().at(-1).next_follow_up_date).toBe(IN_30)
  })

  it('an EARLY touch leaves a future reminder untouched (it used to wipe it)', async () => {
    await markLeadTouched({ id: 1, stage: 'responded', next_follow_up_date: '2026-12-05', follow_up_note: 'after their board meeting' }, 7)
    expect(reminderWrites()).toEqual([])
  })

  it('a finished cadence falls back to the default, never to nothing', async () => {
    const lead = { id: 1, stage: 'responded', next_follow_up_date: '2026-11-10', follow_up_cadence: { offsets: [3, 7], step: 2, anchor: '2026-11-03' } }
    await advanceFollowUpCadence(lead, 7)
    const last = reminderWrites().at(-1)
    expect(last.next_follow_up_date).toBe(IN_30)
    expect(last.follow_up_cadence).toBeNull()
  })

  it('marking a lead dead is the one thing that ends its reminders', () => {
    expect(DEAD_LEAD_UPDATES).toEqual({ stage: 'passed', next_follow_up_date: null, follow_up_cadence: null })
  })

  it('"still working" with no date on a lead with no reminder gets the default', async () => {
    h.leadRow = { next_follow_up_date: null, stage: 'responded' }
    await disposeLead(1, { disposition: 'working' }, 7)
    expect(reminderWrites().at(-1).next_follow_up_date).toBe(IN_30)
  })

  it('"still working" on a lead that already has a reminder leaves it alone', async () => {
    h.leadRow = { next_follow_up_date: '2026-12-01', stage: 'responded' }
    await disposeLead(1, { disposition: 'working' }, 7)
    expect(reminderWrites()).toEqual([])
  })

  it('only leads that have replied get the automatic reminder (no 150-lead bell flood)', async () => {
    expect(REMINDER_STAGES).toEqual(['responded', 'meeting_booked', 'warm_active', 'reach_out_later'])
    for (const stage of ['outreach', 'client', 'passed']) expect(getsDefaultReminder({ stage })).toBe(false)
    await markLeadTouched({ id: 1, stage: 'outreach', next_follow_up_date: null }, 7)
    expect(reminderWrites()).toEqual([])
  })

  it('the automatic check-in is a safety net, not a promise — staleness nudges still fire', async () => {
    expect(isDefaultReminder({ next_follow_up_date: IN_30, follow_up_note: DEFAULT_FOLLOW_UP_NOTE })).toBe(true)
    expect(isDefaultReminder({ next_follow_up_date: IN_30, follow_up_note: 'after their board meeting' })).toBe(false)
    const fs = await import('node:fs')
    const notif = fs.readFileSync(new URL('../src/lib/api/notifications.js', import.meta.url), 'utf8')
    expect(notif).toMatch(/next_follow_up_date\.is\.null,follow_up_note\.eq\.\$\{DEFAULT_FOLLOW_UP_NOTE\}/)
    const today = fs.readFileSync(new URL('../src/lib/api/today.js', import.meta.url), 'utf8')
    expect(today).toMatch(/!isDefaultReminder\(lead\)/)
  })

  it('every dead path ends reminders: updateLead and moveLead to passed', async () => {
    await updateLead(1, { stage: 'passed' }, 7)
    expect(reminderWrites().at(-1)).toMatchObject({ stage: 'passed', next_follow_up_date: null, follow_up_cadence: null })
    await moveLead(1, 'passed', 7)
    expect(reminderWrites().at(-1)).toMatchObject({ stage: 'passed', next_follow_up_date: null, follow_up_cadence: null })
  })

  it('nothing outside followups.js clears a reminder', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = new URL('../src/', import.meta.url).pathname
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
    const callers = walk(src)
      .filter(f => /\.(jsx?)$/.test(f) && !f.endsWith('lib/api/followups.js'))
      .filter(f => /\bclearFollowUp\s*\(/.test(fs.readFileSync(f, 'utf8').replace(/export async function clearFollowUp/, '')))
      .map(f => path.relative(src, f))
    expect(callers).toEqual([])
  })
})
