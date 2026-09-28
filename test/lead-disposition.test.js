// Guardrails for the 30-day disposition and the surfacing window.
//
// Dev, 27 Sept 2026: "the whole point of the thirty day thing is that the person
// who's responsible for the lead has to update it. After those thirty days they
// have to update the lead, because otherwise — if the lead is dead we have to
// mark it as dead, or if they've said get back to me after three months we need
// a way for the person to be updated like that. So we know exactly what's
// happening with each of our leads."
//
// The rules that make that true, and that a later refactor would quietly undo:
//
//  1. DEAD NEEDS A REASON. Recording the reason is the entire point — "we passed
//     on 300 leads" with no reason cannot distinguish price from timing from
//     ghosting, which are three different problems.
//  2. "COME BACK LATER" NEEDS A DATE. Without one it is indistinguishable from
//     forgetting, which is the failure being replaced.
//  3. ANSWERING THE CLOCK RESETS IT. disposed_at counts as a touch, because the
//     clock asks "has someone said what is happening", not "has a row changed".
//  4. NOTHING IS DELETED OR ARCHIVED. A passed lead stays in the pipeline's
//     passed column so the team can see what was lost and why.
//  5. THE SURFACING WINDOW IS A DISPLAY FLOOR, and the Sept 2026 notification
//     rework removed one on purpose. Dev overruled that knowingly for the
//     73-lead backlog. The backlog must stay COUNTED while it stops nagging — if
//     a refactor makes isStaleBreach agree with shouldSurfaceBreach, 32 leads
//     silently cease to exist.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'
import {
  STALE_BREACH_DAYS, STALE_SURFACE_WINDOW_DAYS,
  isStaleBreach, shouldSurfaceBreach, daysOverClock, daysSinceTouch, leadBreaches
} from '../src/lib/leadHealth.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { disposeLead, DISPOSITIONS } = await import('../src/lib/api/leads.js')

const NOW = new Date('2026-09-28T12:00:00+05:30')
const TODAY = '2026-09-28'
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString()
const opts = { today: TODAY, now: NOW }

// ============================================================================
// THE SURFACING WINDOW
// ============================================================================

describe('the surfacing window', () => {
  it('surfaces a breach that crossed the clock recently', () => {
    // 40 days quiet = 10 days past a 30-day clock.
    const lead = { stage: 'responded', last_activity_date: daysAgo(40) }
    expect(isStaleBreach(lead, opts)).toBe(true)
    expect(shouldSurfaceBreach(lead, opts)).toBe(true)
    expect(daysOverClock(lead, opts)).toBe(10)
  })

  it('stops surfacing once it is old, but KEEPS counting it as a breach', () => {
    // 120 days quiet = 90 days past the clock, well beyond the window.
    const lead = { stage: 'responded', last_activity_date: daysAgo(120) }
    expect(isStaleBreach(lead, opts)).toBe(true)      // still a breach — 32 leads live here
    expect(shouldSurfaceBreach(lead, opts)).toBe(false) // but not in this week's queue
  })

  it('surfaces right up to the edge of the window and not past it', () => {
    const atEdge = { stage: 'responded', last_activity_date: daysAgo(STALE_BREACH_DAYS + STALE_SURFACE_WINDOW_DAYS) }
    const pastEdge = { stage: 'responded', last_activity_date: daysAgo(STALE_BREACH_DAYS + STALE_SURFACE_WINDOW_DAYS + 1) }
    expect(shouldSurfaceBreach(atEdge, opts)).toBe(true)
    expect(shouldSurfaceBreach(pastEdge, opts)).toBe(false)
  })

  it('never surfaces something that is not a breach at all', () => {
    expect(shouldSurfaceBreach({ stage: 'responded', last_activity_date: daysAgo(5) }, opts)).toBe(false)
    expect(shouldSurfaceBreach({ stage: 'client', last_activity_date: daysAgo(400) }, opts)).toBe(false)
  })

  it('reports both states on the combined badge', () => {
    const old = leadBreaches({ stage: 'responded', last_activity_date: daysAgo(120) }, opts)
    expect(old.staleBreach).toBe(true)
    expect(old.staleSurfacing).toBe(false)
    expect(old.daysOverClock).toBe(90)
  })
})

// ============================================================================
// DISPOSITION RESETS THE CLOCK
// ============================================================================

describe('disposed_at answers the clock', () => {
  it('counts a disposition as a touch even when nothing else moved', () => {
    const lead = { stage: 'responded', last_activity_date: daysAgo(90), disposed_at: daysAgo(2) }
    expect(daysSinceTouch(lead, NOW)).toBe(2)
    expect(isStaleBreach(lead, opts)).toBe(false)
  })

  it('takes the most recent of activity and disposition, not the first it finds', () => {
    const touchedRecently = { stage: 'responded', last_activity_date: daysAgo(1), disposed_at: daysAgo(90) }
    expect(daysSinceTouch(touchedRecently, NOW)).toBe(1)
    expect(isStaleBreach(touchedRecently, opts)).toBe(false)
  })

  it('still breaches when the disposition itself has gone stale', () => {
    const lead = { stage: 'responded', last_activity_date: daysAgo(60), disposed_at: daysAgo(45) }
    expect(isStaleBreach(lead, opts)).toBe(true)
    expect(daysOverClock(lead, opts)).toBe(15)
  })
})

// ============================================================================
// THE WRITE
// ============================================================================

function serving(lead = { id: 5, stage: 'responded' }) {
  return (op) => {
    if (op.table === 'crm_leads' && op.type === 'select') return { data: lead }
    if (op.table === 'crm_leads' && op.type === 'update') {
      return { data: op.single ? { ...lead, ...op.payload } : [{ id: lead.id }] }
    }
    if (op.table === 'crm_lead_activities') return { data: { id: 'act-1' } }
    return { data: [] }
  }
}
// The disposition's own update — NOT `.at(-1)`. logActivity stamps
// last_activity_date in a second, later update, so the last crm_leads write is
// always that stamp and an .at(-1) assertion silently tests the wrong row.
const lastUpdate = () =>
  h.db.opsFor('crm_leads', 'update').map(o => o.payload).filter(p => 'disposed_at' in p).at(-1)

// logActivity inserts an ARRAY, so payload.notes is undefined on the row itself.
const noteText = () => {
  const p = h.db.opsFor('crm_lead_activities', 'insert').at(-1)?.payload
  return (Array.isArray(p) ? p[0]?.notes : p?.notes) ?? ''
}

beforeEach(() => { vi.restoreAllMocks(); h.db = fakeSupabase(serving()) })

describe('disposeLead', () => {
  it('refuses to mark a lead dead with no reason', async () => {
    await expect(disposeLead(5, { disposition: 'dead' }, 1)).rejects.toThrow(/reason/i)
    expect(h.db.opsFor('crm_leads', 'update')).toHaveLength(0)
  })

  it('refuses whitespace as a reason', async () => {
    await expect(disposeLead(5, { disposition: 'dead', reason: '   ' }, 1)).rejects.toThrow(/reason/i)
  })

  it('refuses "come back later" with no date — that is just forgetting', async () => {
    await expect(disposeLead(5, { disposition: 'later' }, 1)).rejects.toThrow(/date/i)
    expect(h.db.opsFor('crm_leads', 'update')).toHaveLength(0)
  })

  it('rejects an unknown disposition rather than silently doing nothing', async () => {
    await expect(disposeLead(5, { disposition: 'maybe' }, 1)).rejects.toThrow(/Unknown disposition/)
  })

  it('marks dead with the reason, the note, and no further nagging', async () => {
    await disposeLead(5, { disposition: 'dead', reason: 'Budget too small', note: 'Only 1cr' }, 7)
    const u = lastUpdate()

    expect(u.stage).toBe('passed')
    expect(u.dead_reason).toBe('Budget too small')
    expect(u.dead_reason_note).toBe('Only 1cr')
    expect(u.next_follow_up_date).toBeNull()
    expect(u.follow_up_cadence).toBeNull()
    expect(u.disposed_by).toBe(7)
    expect(u.disposed_at).toBeTruthy()
    expect(noteText()).toMatch(/Marked dead — Budget too small/)
  })

  it('parks a lead for later with the date they actually asked for', async () => {
    await disposeLead(5, { disposition: 'later', followUpDate: '2026-12-20', note: 'After their raise' }, 7)
    const u = lastUpdate()

    expect(u.stage).toBe('reach_out_later')
    expect(u.reach_out_later_date).toBe('2026-12-20')
    // Both, so the Today queue and the notification feed pick it up too.
    expect(u.next_follow_up_date).toBe('2026-12-20')
    expect(u.disposed_at).toBeTruthy()
  })

  it('records a hand-off to the investor book with its own reason', async () => {
    await disposeLead(5, { disposition: 'investor' }, 7)
    expect(lastUpdate().dead_reason).toBe('Better as an investor')
    expect(lastUpdate().stage).toBe('passed')
  })

  it('lets an owner say "still working it" and answer the clock without a stage change', async () => {
    await disposeLead(5, { disposition: 'working', note: 'Call booked for Thursday' }, 7)
    const u = lastUpdate()

    expect(u.stage).toBeUndefined()      // nothing moved
    expect(u.disposed_at).toBeTruthy()   // but the clock is answered
    expect(noteText()).toMatch(/Still working it/)
  })

  it('never deletes and never archives — a passed lead stays visible', async () => {
    for (const d of DISPOSITIONS) {
      h.db = fakeSupabase(serving())
      await disposeLead(5, { disposition: d, reason: 'Other', followUpDate: '2026-12-01' }, 7)
      expect(h.db.opsFor('crm_leads', 'delete')).toHaveLength(0)
      expect(lastUpdate().is_archived).toBeUndefined()
    }
  })

  it('always logs what happened, so the 30-day answer is in the activity trail', async () => {
    await disposeLead(5, { disposition: 'dead', reason: 'Not interested' }, 7)
    expect(noteText()).toMatch(/30-day update/)
  })
})
