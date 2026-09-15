// Guardrails for the CallHippo sync watchdog.
//
// This is the one job in the CRM where silence DESTROYS data rather than
// delaying it: CallHippo drops call logs after about a month, so every day the
// importer is down is a day of dials that can never be recovered. The weekly
// digest already documents the standing gap — "if the cron never fires at all,
// nothing alerts" — and that gap is unacceptable here.
//
// These pin the two rules everything else is built on: the window default that
// makes a single run self-healing, and the thresholds that decide when a human
// gets told.

import { describe, it, expect } from 'vitest'

// Mirrors the rule in api/health.js, src/lib/api/calls.js and the digest
// watchdog. If this drifts, the banner, the health endpoint and the digest
// start disagreeing about whether the sync is fine.
function classify(ageDays) {
  return {
    stale: ageDays == null || ageDays >= 2,
    critical: ageDays == null || ageDays >= 25,
  }
}

describe('staleness thresholds', () => {
  it('treats one missed night as noise, two as a pattern', () => {
    // The job runs daily. A single miss is a blip; two is a dead cron.
    expect(classify(0).stale).toBe(false)
    expect(classify(1).stale).toBe(false)
    expect(classify(2).stale).toBe(true)
  })

  it('escalates before CallHippo starts deleting, not after', () => {
    // Retention is ~30 days. Waiting until day 30 to shout means the first
    // warning arrives only once data is already unrecoverable.
    expect(classify(24).critical).toBe(false)
    expect(classify(25).critical).toBe(true)
    expect(classify(25).stale).toBe(true)
  })

  it('treats "never run" as the most severe state, not the safest', () => {
    // A null age is the brand-new-deployment case AND the never-worked case.
    // Reading it as healthy is how a broken importer stays invisible forever.
    expect(classify(null).stale).toBe(true)
    expect(classify(null).critical).toBe(true)
  })

  it('is monotonic — staleness never improves as time passes', () => {
    let sawStale = false
    let sawCritical = false
    for (let d = 0; d <= 40; d += 1) {
      const c = classify(d)
      if (c.stale) sawStale = true
      if (c.critical) sawCritical = true
      expect(c.stale, `day ${d} un-stale after being stale`).toBe(sawStale ? true : c.stale)
      expect(c.critical, `day ${d} un-critical after being critical`).toBe(sawCritical ? true : c.critical)
      // critical must imply stale, or health could 503 while the UI says fine.
      if (c.critical) expect(c.stale).toBe(true)
    }
  })
})

describe('the sync window default', () => {
  // Mirrors api/callhippo-sync.js.
  const windowDays = (q) => Math.min(Number(q) || 29, 29)

  it('defaults to the full retention window, not to "since yesterday"', () => {
    // This is the whole self-healing property: one successful run after an
    // outage repairs every gap the API can still see. A 1-day default would
    // mean one missed night equals one permanently lost night.
    expect(windowDays(undefined)).toBe(29)
    expect(windowDays('')).toBe(29)
    expect(windowDays(0)).toBe(29)
  })

  it('never asks for more than the plan allows', () => {
    // Asking for >1 month errors the ENTIRE request — not a partial result —
    // so an over-wide window would import nothing at all.
    expect(windowDays('90')).toBe(29)
    expect(windowDays(9999)).toBe(29)
  })

  it('still honours a smaller explicit window', () => {
    expect(windowDays('7')).toBe(7)
  })
})
