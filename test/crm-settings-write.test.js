// Guardrails for the staleness-threshold editor.
//
// crm_settings had ONE row, written 2026-02-05, and no write path anywhere in
// the app — getCRMSettings was its only reference. Those three numbers drive
// calculateStaleness, getStaleLeads and the Today tab's marks, and measured
// 2026-09-29 they flagged 68% of the live pipeline as stale (92% of
// meeting_booked). A staleness colour red on two thirds of the board carries no
// information, and nobody could change it without database access.
//
// The rules worth pinning now that it IS writable:
//
//  1. ONLY the three threshold keys. This is not a general settings PATCH — the
//     same row carries email_alerts, slack_alerts and a dead
//     weekly_discovery_call_target, and a permissive writer would let the UI
//     stomp any of them.
//  2. NEVER 0 OR NEGATIVE. The comparison is `daysSince > threshold`, so 0 makes
//     every lead with any age instantly stale — the entire board red, which is
//     the failure this editor exists to fix.
//  3. THE CACHE MUST BE BUSTED. getCRMSettings memoises for 60s; without a bust
//     the board keeps colouring against the old numbers after a save and the
//     change looks like it silently failed.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { updateCRMSettings, getCRMSettings, STALENESS_SETTINGS } = await import('../src/lib/api/misc.js')

const ROW = {
  id: 1,
  cold_outreach_threshold: 5,
  warm_lead_threshold: 7,
  active_conversation_threshold: 3,
  weekly_discovery_call_target: 7,
  email_alerts: true,
  slack_alerts: false,
}

const serving = (row = ROW) => (op) => {
  if (op.table === 'crm_settings' && op.type === 'update') return { data: { ...row, ...op.payload } }
  if (op.table === 'crm_settings') return { data: row }
  return { data: [] }
}

const payload = () => h.db.opsFor('crm_settings', 'update').at(-1).payload

beforeEach(() => { vi.restoreAllMocks(); h.db = fakeSupabase(serving()) })

describe('what the editor exposes', () => {
  it('offers exactly the three thresholds that drive staleness', () => {
    expect(STALENESS_SETTINGS.map(s => s.key)).toEqual([
      'cold_outreach_threshold', 'warm_lead_threshold', 'active_conversation_threshold'
    ])
  })

  it('names the stages each one governs, so the UI can show real impact', () => {
    const byKey = Object.fromEntries(STALENESS_SETTINGS.map(s => [s.key, s.stages]))
    expect(byKey.cold_outreach_threshold).toEqual(['outreach'])
    expect(byKey.warm_lead_threshold).toEqual(['responded'])
    // Booked meetings age as fast as live conversations — that mapping lives in
    // leads.js and this must agree with it.
    expect(byKey.active_conversation_threshold).toEqual(['meeting_booked', 'warm_active'])
  })
})

describe('updateCRMSettings', () => {
  it('writes the thresholds it was given', async () => {
    await updateCRMSettings({ cold_outreach_threshold: 14, active_conversation_threshold: 10 })

    expect(payload()).toMatchObject({ cold_outreach_threshold: 14, active_conversation_threshold: 10 })
    expect(payload().updated_at).toBeTruthy()
  })

  it('records WHO changed it, not just when (migration 057)', async () => {
    // One row, and it changes the staleness colouring for the whole team on every
    // board. RLS lets any signed-in user write it, so the attribution matters.
    await updateCRMSettings({ warm_lead_threshold: 12 }, 7)
    expect(payload().updated_by).toBe(7)
  })

  it('stores null rather than inventing an actor when none was passed', async () => {
    await updateCRMSettings({ warm_lead_threshold: 12 })
    expect(payload().updated_by).toBeNull()
  })

  it('ignores every key that is not a staleness threshold', async () => {
    await updateCRMSettings({
      cold_outreach_threshold: 14,
      email_alerts: false,            // must not be stomped
      slack_alerts: true,             // must not be stomped
      weekly_discovery_call_target: 99,
      id: 2,                          // must never be repointed
    })

    const p = payload()
    expect(p).toMatchObject({ cold_outreach_threshold: 14 })
    for (const k of ['email_alerts', 'slack_alerts', 'weekly_discovery_call_target', 'id']) {
      expect(p).not.toHaveProperty(k)
    }
  })

  it.each([0, -1, -30])('refuses %p — it would paint the whole board stale', async (v) => {
    await expect(updateCRMSettings({ cold_outreach_threshold: v })).rejects.toThrow(/between 1 and 365/)
    expect(h.db.opsFor('crm_settings', 'update')).toHaveLength(0)
  })

  it('refuses an absurdly large value and anything non-numeric', async () => {
    await expect(updateCRMSettings({ warm_lead_threshold: 4000 })).rejects.toThrow(/between 1 and 365/)
    await expect(updateCRMSettings({ warm_lead_threshold: 'soon' })).rejects.toThrow(/must be a number/)
    expect(h.db.opsFor('crm_settings', 'update')).toHaveLength(0)
  })

  it('refuses a no-op rather than writing an empty update', async () => {
    await expect(updateCRMSettings({ email_alerts: false })).rejects.toThrow(/Nothing to update/)
    expect(h.db.opsFor('crm_settings', 'update')).toHaveLength(0)
  })

  it('rounds a fractional day rather than storing it', async () => {
    await updateCRMSettings({ warm_lead_threshold: 7.6 })
    expect(payload().warm_lead_threshold).toBe(8)
  })

  it('targets the single settings row, never a bare update', async () => {
    await updateCRMSettings({ warm_lead_threshold: 9 })
    const op = h.db.opsFor('crm_settings', 'update').at(-1)
    expect(op.filters).toEqual(expect.arrayContaining([['eq', 'id', 1]]))
  })

  it('busts the 60s cache, so the board recolours immediately', async () => {
    // Order-independent on purpose: _settingsCache is module state that survives
    // between tests in this file, so asserting a specific "before" value would
    // make this pass or fail depending on what ran first. The invariant is that a
    // read AFTER a save reflects the save — whatever the cache held before.
    //
    // The DB is stubbed to keep serving the ORIGINAL row, so a stale read returns
    // 7 and only a genuine cache bust can return 21.
    h.db = fakeSupabase(serving())
    await updateCRMSettings({ warm_lead_threshold: 21 })

    expect((await getCRMSettings()).warm_lead_threshold).toBe(21)
    // And the read was served from cache, not re-fetched.
    expect(h.db.opsFor('crm_settings', 'select')).toHaveLength(0)
  })
})
