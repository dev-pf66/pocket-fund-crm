// Guardrails against phantom quotas.
//
// Targets were deliberately zeroed in Aug 2026 (Dev: sales moved to a
// low-volume, high-targeting motion, so a daily send quota measured the wrong
// thing). Every person in the database is 0 or NULL. But three separate meters
// kept holding the team to a number anyway, and each survived the zeroing for
// the SAME reason: the quota was a literal in the code, not a read of the
// column, so setting the column to 0 never touched it.
//
//   1. Dashboard "Today's Outreach" — `todayCount / personTarget` with a bar.
//      Read the column, so zeroing it made the bar 0-wide and the denominator
//      "/ 0" — visibly broken, and replaced by the scoreboard.
//   2. OutreachTracker "Today's Progress" — `todayCount / 10`, HARDCODED. Showed
//      "/10", a bar, and "Goal Met!". Invisible to the zeroing.
//   3. getPersonDashboardStats `dailyGoal = 10` default, which the only caller
//      never overrode — so the streak meant "consecutive days with 10+ touches",
//      a bar the team has never once cleared (61 touches team-wide in the
//      busiest recent week). The `dailyGoal > 0` guard inside was written for the
//      zeroed case and was unreachable.
//
// So: no default target is ever a positive number, and hasTarget is only ever
// asked about a number.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

// From src/lib/targets.js, not from the page. Importing Dashboard.jsx here drags
// in App → Layout → the whole component tree and blows up in the node
// environment — which is exactly why these helpers were untestable, and exactly
// how three phantom quotas survived unnoticed.
import {
  DEFAULT_DAILY_TARGET, DEFAULT_WEEKLY_TARGET, dailyTargetOf, weeklyTargetOf, hasTarget
} from '../src/lib/targets.js'

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

/**
 * Source with comments stripped. Every assertion below is about what the code
 * DOES, and the comments deliberately quote the old broken forms to explain them
 * — so scanning raw source makes the explanation trip the check it explains.
 */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

describe('no default is a quota', () => {
  it('the daily and weekly defaults are 0 — no target, not a number', () => {
    expect(DEFAULT_DAILY_TARGET).toBe(0)
    expect(DEFAULT_WEEKLY_TARGET).toBe(0)
  })

  it('getPersonDashboardStats defaults dailyGoal to 0, not 10', () => {
    // A positive default here silently becomes a streak bar nobody asked for,
    // because the caller does not have to opt in to being measured.
    const src = code('../src/lib/api/outreach.js')
    const sig = src.match(/getPersonDashboardStats\(personId, \{([^}]*)\}/)?.[1] ?? ''
    expect(sig).toMatch(/dailyGoal = 0/)
    expect(sig).not.toMatch(/dailyGoal = [1-9]/)
  })

  it('reads the person for a target, and 0 survives as an explicit "none"', () => {
    expect(dailyTargetOf({ daily_outreach_target: 25 })).toBe(25)
    expect(weeklyTargetOf({ weekly_outreach_target: 100 })).toBe(100)
    // ?? not ||, so an explicit 0 is not replaced by a fallback.
    expect(dailyTargetOf({ daily_outreach_target: 0 })).toBe(0)
    expect(dailyTargetOf({})).toBe(0)
    expect(dailyTargetOf(null)).toBe(0)
  })
})

describe('hasTarget is asked about a number', () => {
  it('is true only for a positive number', () => {
    expect(hasTarget(25)).toBe(true)
    expect(hasTarget(0)).toBe(false)
    expect(hasTarget(null)).toBe(false)
    expect(hasTarget(undefined)).toBe(false)
  })

  it('is false for an object — which is why passing a person was a silent bug', () => {
    // ColdCalls called hasTarget(person). Number({...}) is NaN, NaN > 0 is false,
    // so the card read "no target set" for everyone forever. Invisible while every
    // target is 0; wrong the moment one is set.
    expect(hasTarget({ daily_outreach_target: 25 })).toBe(false)
  })

  it('no page asks hasTarget about a person object', () => {
    for (const f of ['../src/pages/ColdCalls.jsx', '../src/pages/OutreachTracker.jsx',
                     '../src/pages/OutreachAdmin.jsx', '../src/pages/Dashboard.jsx']) {
      expect(code(f)).not.toMatch(/hasTarget\(\s*(person|currentPerson|u|p)\s*\)/)
    }
  })
})

describe('no user-facing copy hardcodes a quota', () => {
  it.each([
    ['../src/pages/OutreachTracker.jsx', 'OutreachTracker'],
    ['../src/pages/ColdCalls.jsx', 'ColdCalls'],
    ['../src/pages/Dashboard.jsx', 'Dashboard'],
  ])('%s has no literal "/10" denominator or "Hit 10" prompt', (path) => {
    const src = code(path)
    expect(src).not.toMatch(/>\s*\/10\s*</)
    expect(src).not.toMatch(/Hit 10 /)
    expect(src).not.toMatch(/10\+ outreach/)
    expect(src).not.toMatch(/todayCount\s*\/\s*10\b/)
    expect(src).not.toMatch(/todayCount\s*>=\s*10\b/)
  })
})
