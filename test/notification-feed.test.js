// Guardrails for the derived notification feed.
//
// The feed replaced a bell that watched exactly one hand-entered column and
// was therefore almost always empty while the pipeline went cold. These pin
// the properties that made the replacement worth doing, each of which fails
// silently rather than loudly if it regresses:
//
//  1. Staleness is CONTINUOUS. The old Today-tab cadence marks fired on
//     `marks.has(daysStale)` — day 3, day 7, day 14 EXACTLY, then silence
//     forever. 179 engaged leads were past all three marks and pinged nothing.
//  2. Archived leads produce no signal anywhere.
//  3. One lead never produces two rows for the same reason.
//  4. A single failing source degrades that source and SAYS SO, instead of
//     blanking the page or — worse — quietly returning a shorter list.
//  5. The badge counts what needs you now (overdue + today), never the
//     upcoming ones. A bell that counts things you cannot act on yet is a
//     bell people learn to ignore.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))

vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { getNotificationFeed, getNotificationCounts } = await import('../src/lib/api/notifications.js')

const SETTINGS = {
  id: 1,
  cold_outreach_threshold: 3,
  warm_lead_threshold: 7,
  active_conversation_threshold: 14
}

const today = () => new Date().toISOString().slice(0, 10)
function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString()
}
function daysAhead(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
}

/**
 * Serve a canned table set. Every crm_leads select gets the rows the test
 * asked for; fetchAllRows pages, so only page 1 is populated.
 */
function dbWith({ leads = [], quiet = [], calls = [], demos = [], sellers = [], partners = [], fail = null } = {}) {
  let leadSelects = 0
  return fakeSupabase(op => {
    if (op.table === 'crm_settings') return { data: SETTINGS, error: null }
    if (op.table === fail) return { data: null, error: new Error(`${fail} is down`) }

    const [from] = op.range || [0]
    const page = rows => ({ data: from === 0 ? rows : [], error: null })

    if (op.table === 'crm_leads') {
      // Sources run in a fixed order: scheduled follow-ups, then went-quiet.
      // Only page-1 builds advance the counter.
      if (from === 0) leadSelects += 1
      return page(leadSelects <= 1 ? leads : quiet)
    }
    if (op.table === 'crm_outreach_log') return page(calls)
    if (op.table === 'crm_demos') return page(demos)
    if (op.table === 'crm_sellers') return page(sellers)
    if (op.table === 'crm_partners') return page(partners)
    return page([])
  })
}

const engaged = over => ({
  id: 1, name: 'Chaitanya', firm_name: 'Searchlight', stage: 'responded',
  assigned_to: 6, lead_score: 50, linkedin_url: null,
  last_activity_date: daysAgo(40), created_at: daysAgo(120),
  next_follow_up_date: null, ...over
})

beforeEach(() => { vi.restoreAllMocks() })

// ---------------------------------------------------------------------------

describe('staleness is continuous, not an exact-day match', () => {
  it('surfaces a responded lead quiet for 40 days', async () => {
    // The whole point. The old exact-match marks (3/7/14) scored this zero.
    h.db = dbWith({ quiet: [engaged({ last_activity_date: daysAgo(40) })] })
    const { items } = await getNotificationFeed(6)
    const quiet = items.filter(i => i.kind === 'went_quiet')
    expect(quiet).toHaveLength(1)
    expect(quiet[0].quietDays).toBeGreaterThanOrEqual(40)
  })

  it.each([8, 15, 40, 200])('surfaces a responded lead quiet for %i days', async n => {
    h.db = dbWith({ quiet: [engaged({ last_activity_date: daysAgo(n) })] })
    const { items } = await getNotificationFeed(6)
    expect(items.filter(i => i.kind === 'went_quiet')).toHaveLength(1)
  })

  it('stays quiet inside the threshold', async () => {
    // responded uses the warm threshold (7). Day 3 is not yet a problem.
    h.db = dbWith({ quiet: [engaged({ last_activity_date: daysAgo(3) })] })
    const { items } = await getNotificationFeed(6)
    expect(items.filter(i => i.kind === 'went_quiet')).toHaveLength(0)
  })

  it('ranks a longer silence above a shorter one', async () => {
    h.db = dbWith({
      quiet: [
        engaged({ id: 1, name: 'Recent', last_activity_date: daysAgo(9) }),
        engaged({ id: 2, name: 'Ancient', last_activity_date: daysAgo(90) })
      ]
    })
    const { items } = await getNotificationFeed(6)
    const quiet = items.filter(i => i.kind === 'went_quiet')
    expect(quiet.map(i => i.title)).toEqual(['Ancient', 'Recent'])
  })
})

describe('archived leads', () => {
  it('are excluded by every crm_leads query the feed makes', async () => {
    h.db = dbWith({})
    await getNotificationFeed(6)
    const leadReads = h.db.ops.filter(o => o.table === 'crm_leads' && o.type === 'select')
    expect(leadReads.length).toBeGreaterThan(0)
    for (const read of leadReads) {
      expect(read.filters).toContainEqual(['eq', 'is_archived', false])
    }
  })
})

describe('one lead, one reason', () => {
  it('asks the database to exclude scheduled leads from the went-quiet source', async () => {
    // A lead with a follow-up date is already represented by its `followup`
    // item. Without this filter it would appear twice, which is how a feed
    // starts feeling like noise.
    h.db = dbWith({})
    await getNotificationFeed(6)
    const reads = h.db.ops.filter(o => o.table === 'crm_leads' && o.type === 'select')
    const quietRead = reads.find(r => r.filters.some(f => f[0] === 'is' && f[1] === 'next_follow_up_date'))
    expect(quietRead, 'the went-quiet source should filter out scheduled leads').toBeTruthy()
  })

  it('skips unowned leads in the went-quiet source — they are their own signal', async () => {
    h.db = dbWith({ quiet: [engaged({ assigned_to: null })] })
    const { items } = await getNotificationFeed(null)
    expect(items.filter(i => i.kind === 'went_quiet')).toHaveLength(0)
  })
})

describe('a failing source degrades loudly', () => {
  it('keeps the rest of the feed and reports what broke', async () => {
    h.db = dbWith({ quiet: [engaged()], fail: 'crm_demos' })
    const { items, errors } = await getNotificationFeed(6)

    expect(items.filter(i => i.kind === 'went_quiet')).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0].source).toBe('demo')
  })

  it('marks the badge degraded so the number reads as a floor', async () => {
    h.db = dbWith({ quiet: [engaged()], fail: 'crm_demos' })
    const counts = await getNotificationCounts(6)
    expect(counts.degraded).toBe(true)
  })

  it('is not degraded when every source answers', async () => {
    h.db = dbWith({ quiet: [engaged()] })
    const counts = await getNotificationCounts(6)
    expect(counts.degraded).toBe(false)
  })
})

describe('the badge counts what needs you now', () => {
  it('excludes upcoming work from the badge but keeps it in the feed', async () => {
    const scheduledLater = {
      id: 9, name: 'Next week', firm_name: null, stage: 'responded',
      assigned_to: 6, lead_score: 10, linkedin_url: null,
      next_follow_up_date: daysAhead(10), follow_up_note: null, follow_up_cadence: null
    }
    h.db = dbWith({ leads: [scheduledLater] })

    const { items, counts } = await getNotificationFeed(6)
    expect(items).toHaveLength(1)
    expect(counts.upcoming).toBe(1)

    const badge = await getNotificationCounts(6)
    expect(badge.total).toBe(0)
  })

  it('counts an overdue follow-up', async () => {
    const overdue = {
      id: 9, name: 'Late', firm_name: null, stage: 'responded',
      assigned_to: 6, lead_score: 10, linkedin_url: null,
      next_follow_up_date: '2020-01-01', follow_up_note: null, follow_up_cadence: null
    }
    h.db = dbWith({ leads: [overdue] })

    const badge = await getNotificationCounts(6)
    expect(badge.overdue).toBe(1)
    expect(badge.total).toBe(1)
  })

  it('counts a follow-up due today', async () => {
    const due = {
      id: 9, name: 'Now', firm_name: null, stage: 'responded',
      assigned_to: 6, lead_score: 10, linkedin_url: null,
      next_follow_up_date: today(), follow_up_note: null, follow_up_cadence: null
    }
    h.db = dbWith({ leads: [due] })

    const badge = await getNotificationCounts(6)
    expect(badge.dueToday).toBe(1)
    expect(badge.overdue).toBe(0)
  })
})

describe('no arbitrary display floor', () => {
  it('still reports a follow-up missed months ago', async () => {
    // The old page hid anything more than 14 days overdue, which is amnesia
    // dressed as tidiness. Forgetting is now an explicit act (archiving).
    const ancient = {
      id: 9, name: 'Forgotten', firm_name: null, stage: 'responded',
      assigned_to: 6, lead_score: 10, linkedin_url: null,
      next_follow_up_date: '2026-01-01', follow_up_note: null, follow_up_cadence: null
    }
    h.db = dbWith({ leads: [ancient] })
    const { items } = await getNotificationFeed(6)
    expect(items.map(i => i.title)).toContain('Forgotten')
  })
})

describe('unowned engaged leads', () => {
  it('are admin-only — a rep\'s bell does not fill with work nobody owns', async () => {
    h.db = dbWith({})
    await getNotificationFeed(6, { isAdmin: false })
    const unownedRead = h.db.ops.find(o =>
      o.table === 'crm_leads' && o.filters.some(f => f[0] === 'is' && f[1] === 'assigned_to'))
    expect(unownedRead).toBeUndefined()
  })

  it('are queried for an admin', async () => {
    h.db = dbWith({})
    await getNotificationFeed(null, { isAdmin: true })
    const unownedRead = h.db.ops.find(o =>
      o.table === 'crm_leads' && o.filters.some(f => f[0] === 'is' && f[1] === 'assigned_to'))
    expect(unownedRead).toBeTruthy()
  })
})
