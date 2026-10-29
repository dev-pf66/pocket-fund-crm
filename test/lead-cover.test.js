// Guardrails for lead cover (migration 062, src/lib/api/cover.js).
//
// Dev, 2026-10-29: Sidharth "is helping me manage and maintain all my leads".
// Every work surface was scoped on assigned_to = you, so Dev's leads going
// quiet nagged only Dev (escalation-only) and nobody worked them — and a
// non-admin's Pipeline board did not even LOAD someone else's leads.
//
// What must not regress, each of which fails silently:
//
//  1. A coverer's work surfaces include the owner's leads. A hand-written
//     .eq('assigned_to', personId) on a work query quietly drops them again.
//  2. Ended cover does not count. The cover read filters ended_at IS NULL.
//  3. null personId (the admin "every owner" view) stays UNSCOPED — scoping it
//     to [null] would empty the admin view.
//  4. Credit stays with the person: touch counts read logged_by = them, never
//     the owner they cover.
//  5. Cover is ENDED, never deleted — the row is the record of who covered whom.
//  6. getLeads only widens when asked (includeCovered). The dashboard and stats
//     read through it and must keep counting a person's own book.
//  7. The scoreboard does not read cover: a covered lead's breach counts stay
//     on the owner's row only, or the team total would count it twice.
//  8. An unreadable cover table falls back to the person's own leads instead of
//     blanking the Today tab for everyone.

import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { cacheClear } = await import('../src/lib/api/core.js')
const { ownerScopeIds, startLeadCover, endLeadCover } = await import('../src/lib/api/cover.js')
const { getTodayQueue, getFollowUpsDue, getEscalations, getTodayCounters } = await import('../src/lib/api/today.js')
const { getNotificationFeed } = await import('../src/lib/api/notifications.js')
const { getLeads } = await import('../src/lib/api/leads.js')

const SIDHARTH = 16
const DEV = 1

const SETTINGS = { id: 1, cold_outreach_threshold: 3, warm_lead_threshold: 7, active_conversation_threshold: 14 }

function db({ cover = [{ owner_id: DEV }], coverError = null } = {}) {
  return fakeSupabase(op => {
    if (op.table === 'crm_lead_cover' && op.type === 'select') {
      return coverError ? { data: null, error: coverError } : { data: cover }
    }
    if (op.table === 'crm_settings') return { data: SETTINGS }
    return { data: [] }
  })
}

const leadOps = (d) => d.opsFor('crm_leads', 'select')
const ownerFilters = (op) => op.filters.filter(f => f[1] === 'assigned_to')

beforeEach(() => {
  cacheClear()
})

describe('work surfaces include the books a person covers', () => {
  it('Today queue, follow-ups and escalations read the owner\'s leads too', async () => {
    h.db = db()
    await getTodayQueue(SIDHARTH)
    await getFollowUpsDue(SIDHARTH)
    await getEscalations(SIDHARTH)
    const ops = leadOps(h.db)
    expect(ops).toHaveLength(3)
    for (const op of ops) {
      expect(ownerFilters(op)).toEqual([['in', 'assigned_to', [SIDHARTH, DEV]]])
    }
  })

  it('the notification feed (follow-ups + went quiet) reads the owner\'s leads too', async () => {
    h.db = db()
    await getNotificationFeed(SIDHARTH)
    const scoped = leadOps(h.db).filter(op => ownerFilters(op).length)
    expect(scoped.length).toBeGreaterThanOrEqual(2)
    for (const op of scoped) {
      expect(ownerFilters(op)).toEqual([['in', 'assigned_to', [SIDHARTH, DEV]]])
    }
  })

  it('someone covering nobody keeps the plain single-owner filter', async () => {
    h.db = db({ cover: [] })
    await getTodayQueue(SIDHARTH)
    expect(ownerFilters(leadOps(h.db)[0])).toEqual([['eq', 'assigned_to', SIDHARTH]])
  })

  it('reads only OPEN cover — an ended link never widens anything', async () => {
    h.db = db()
    await ownerScopeIds(SIDHARTH)
    const [op] = h.db.opsFor('crm_lead_cover', 'select')
    expect(op.filters).toContainEqual(['eq', 'coverer_id', SIDHARTH])
    expect(op.filters).toContainEqual(['is', 'ended_at', null])
  })
})

describe('the admin "every owner" view stays unscoped', () => {
  it('getEscalations(null) has no owner filter and never reads cover', async () => {
    h.db = db()
    await getEscalations(null)
    expect(ownerFilters(leadOps(h.db)[0])).toEqual([])
    expect(h.db.opsFor('crm_lead_cover')).toHaveLength(0)
  })
})

describe('credit follows the work, not the book', () => {
  it('touch counts are logged_by the person only, even while covering', async () => {
    h.db = db()
    await getTodayCounters(SIDHARTH)
    const [touches] = h.db.opsFor('crm_lead_activities', 'select')
    expect(touches.filters).toContainEqual(['eq', 'logged_by', SIDHARTH])
    expect(touches.filters.some(f => f[0] === 'in' && f[1] === 'logged_by')).toBe(false)
  })
})

describe('cover is ended, never deleted', () => {
  it('endLeadCover stamps ended_at / ended_by and issues no delete', async () => {
    h.db = db()
    await endLeadCover(SIDHARTH, DEV, DEV)
    expect(h.db.opsFor('crm_lead_cover', 'delete')).toHaveLength(0)
    const [upd] = h.db.opsFor('crm_lead_cover', 'update')
    expect(upd.payload.ended_by).toBe(DEV)
    expect(typeof upd.payload.ended_at).toBe('string')
    expect(upd.filters).toContainEqual(['is', 'ended_at', null])
  })

  it('startLeadCover refuses self-cover and does not duplicate an open pair', async () => {
    h.db = db()
    await expect(startLeadCover(DEV, DEV)).rejects.toThrow()
    h.db = fakeSupabase(op => op.type === 'select'
      ? { data: [{ id: 7, coverer_id: SIDHARTH, owner_id: DEV }] }
      : { data: null })
    const link = await startLeadCover(SIDHARTH, DEV, DEV)
    expect(link.id).toBe(7)
    expect(h.db.opsFor('crm_lead_cover', 'insert')).toHaveLength(0)
  })
})

describe('getLeads widens only when asked', () => {
  it('without includeCovered the board/dashboard scope is the person\'s own book', async () => {
    h.db = db()
    await getLeads({}, SIDHARTH)
    const [op] = leadOps(h.db)
    expect(op.filters).toContainEqual(['or', `created_by.eq.${SIDHARTH},assigned_to.eq.${SIDHARTH}`])
    expect(h.db.opsFor('crm_lead_cover')).toHaveLength(0)
  })

  it('with includeCovered the owner\'s leads load too', async () => {
    h.db = db()
    await getLeads({ includeCovered: true }, SIDHARTH)
    const [op] = leadOps(h.db)
    expect(op.filters).toContainEqual(['or', `created_by.eq.${SIDHARTH},assigned_to.in.(${SIDHARTH},${DEV})`])
  })
})

describe('the scoreboard never double-counts a covered lead', () => {
  it('scoreboard.js does not read cover', () => {
    const src = readFileSync(new URL('../src/lib/api/scoreboard.js', import.meta.url), 'utf8')
    expect(src).not.toMatch(/cover\.js|crm_lead_cover|ownerScopeIds/)
  })
})

describe('an unreadable cover table degrades to own leads, not a blank tab', () => {
  it('falls back to the single-owner filter', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.db = db({ coverError: { message: 'relation "crm_lead_cover" does not exist' } })
    await getTodayQueue(SIDHARTH)
    expect(ownerFilters(leadOps(h.db)[0])).toEqual([['eq', 'assigned_to', SIDHARTH]])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
