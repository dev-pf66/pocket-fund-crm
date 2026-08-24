// Guardrail for the streak loop that hard-froze the Dashboard.
//
// Outreach targets were zeroed in Aug 2026 (sales went low-volume /
// high-targeting). computeMetrics walked backwards day by day while
// `count >= dailyGoal`; at a goal of 0 that is true for every day, including
// days with no data, so the loop never terminated and the Dashboard and Log
// pages froze the browser tab outright.
//
// These tests fail by hanging rather than by asserting, which is exactly the
// failure mode worth pinning: vitest's timeout catches an infinite loop.

import { describe, it, expect } from 'vitest'
import { computeMetrics, buildDailyCounts } from '../src/lib/outreachMetrics'
import { istToday, istAddDays } from '../src/lib/dateUtils'

const today = istToday()
const counts = (entries) => new Map(entries)

describe('computeMetrics streak', () => {
  it('terminates when the daily goal is 0 (no target)', { timeout: 2000 }, () => {
    const m = computeMetrics(counts([[today, 3], [istAddDays(today, -1), 2]]), 0)
    // At no target the streak means "days with any outreach".
    expect(m.streak).toBe(2)
    expect(m.todayCount).toBe(3)
  })

  it('terminates on an empty history with no target', { timeout: 2000 }, () => {
    const m = computeMetrics(new Map(), 0)
    expect(m.streak).toBe(0)
  })

  it('still counts a real goal the old way', () => {
    const m = computeMetrics(
      counts([[today, 10], [istAddDays(today, -1), 12], [istAddDays(today, -2), 4]]),
      10
    )
    expect(m.streak).toBe(2) // today + yesterday hit 10; the day before didn't
  })

  it('starts from yesterday when today has not hit the goal yet', () => {
    const m = computeMetrics(counts([[today, 1], [istAddDays(today, -1), 10]]), 10)
    expect(m.streak).toBe(1)
  })

  it('never reports a streak longer than the data it was given', { timeout: 2000 }, () => {
    const m = computeMetrics(counts([[today, 1]]), 0)
    expect(m.streak).toBeLessThanOrEqual(2)
  })
})

describe('buildDailyCounts', () => {
  it('buckets rows by outreach_date', () => {
    const m = buildDailyCounts([
      { outreach_date: today }, { outreach_date: today }, { outreach_date: '2026-01-01' }
    ])
    expect(m.get(today)).toBe(2)
    expect(m.get('2026-01-01')).toBe(1)
  })
})
