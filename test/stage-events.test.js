// Guardrails for "what moved" — the outcome metrics that replaced send counts.
//
// isForwardMove decides whether a stage transition counts as a lead moving
// forward. Getting it wrong quietly inflates or deflates the headline number
// on Today and Dashboard, and nobody would notice for weeks.
//
// The tricky cases are the two stages OUTSIDE STAGE_ORDER: `passed` and
// `reach_out_later` both rank -1 via indexOf, so naive comparisons treat them
// as "before new_lead" and count moving out of them as progress.

import { describe, it, expect } from 'vitest'
import { isForwardMove } from '../src/lib/api/leads'

describe('isForwardMove', () => {
  it('counts a step forward along the pipeline', () => {
    expect(isForwardMove('outreach', 'responded')).toBe(true)
    expect(isForwardMove('responded', 'meeting_booked')).toBe(true)
    expect(isForwardMove('meeting_booked', 'warm_active')).toBe(true)
    expect(isForwardMove('warm_active', 'client')).toBe(true)
  })

  it('counts a multi-stage jump forward', () => {
    expect(isForwardMove('outreach', 'meeting_booked')).toBe(true)
  })

  it('does not count a step backwards', () => {
    expect(isForwardMove('warm_active', 'outreach')).toBe(false)
    expect(isForwardMove('client', 'meeting_booked')).toBe(false)
  })

  it('does not count staying put', () => {
    expect(isForwardMove('warm_active', 'warm_active')).toBe(false)
  })

  it('does not count a lead being marked dead', () => {
    // `passed` is terminal and outside STAGE_ORDER — losing a deal is not
    // movement forward, however far along it was.
    expect(isForwardMove('warm_active', 'passed')).toBe(false)
    expect(isForwardMove('outreach', 'passed')).toBe(false)
  })

  it('counts a lead entering the pipeline from an unranked stage', () => {
    // reach_out_later and null both rank -1; picking a parked lead back up
    // genuinely is forward motion.
    expect(isForwardMove('reach_out_later', 'responded')).toBe(true)
    expect(isForwardMove(null, 'outreach')).toBe(true)
  })

  it('does NOT count resurrecting a dead lead as progress', () => {
    // `passed` ranks -1 like the parked stages, so a bare `to > from` scored
    // un-passing as an advance: dismiss a batch on Thursday, reinstate it on
    // Friday, and top the team leaderboard for undoing your own dismissal.
    expect(isForwardMove('passed', 'outreach')).toBe(false)
    expect(isForwardMove('passed', 'meeting_booked')).toBe(false)
  })
})
