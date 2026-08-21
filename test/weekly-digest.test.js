// Guardrails for the Monday digest's accountability rules.
//
// Two of these encode explicit calls from Dev that a well-meaning refactor
// would undo: EVERY non-archived person appears with zeros included (a silent
// week has to be visible), and the TEAM line sums only the rows it prints
// (summing every entry pulled in departed analysts, so the total didn't match
// the rows underneath it).

import { describe, it, expect } from 'vitest'
import { composeDigest } from '../api/weekly-digest.js'

// Monday 2026-08-17 → the digest covers the prior week, 2026-08-10..08-16.
const TODAY = '2026-08-17'
const LAST = { start: '2026-08-10', mid: '2026-08-12' }
const PREV = { start: '2026-08-03', mid: '2026-08-05' }

const PEOPLE = [
  { id: 'aum', name: 'Aum', is_archived: false },
  { id: 'gaurav', name: 'Gaurav', is_archived: false },
  { id: 'quiet', name: 'Quiet Analyst', is_archived: false },
  { id: 'gone', name: 'Departed Analyst', is_archived: true }
]

const outreach = (logged_by, outreach_date, status = 'sent') => ({ logged_by, outreach_date, status })

function digest(overrides = {}) {
  return composeDigest({
    people: PEOPLE,
    outreach: [],
    meetings: [],
    demos: [],
    today: TODAY,
    ...overrides
  })
}

describe('composeDigest', () => {
  it('covers the previous Mon–Sun week', () => {
    const d = digest()
    expect(d.weekKey).toBe('2026-08-10')
    expect(d.title).toContain('2026-08-10')
    expect(d.body).toContain('Week of 2026-08-10 – 2026-08-16')
  })

  it('lists every non-archived person, zeros included', () => {
    // Dev's call, July 2026 — the digest is the accountability view, so an
    // analyst who did nothing must still appear.
    const d = digest({ outreach: [outreach('aum', LAST.mid)] })
    expect(d.body).toContain('Aum:')
    expect(d.body).toContain('Gaurav:')
    expect(d.body).toMatch(/Quiet Analyst: 0 outreach/)
  })

  it('excludes archived people', () => {
    const d = digest({ outreach: [outreach('gone', LAST.mid)] })
    expect(d.body).not.toContain('Departed Analyst')
  })

  it('TEAM totals sum only the rows it prints, not archived contributors', () => {
    const d = digest({
      outreach: [
        outreach('aum', LAST.mid),
        outreach('aum', LAST.mid),
        outreach('gone', LAST.mid) // archived — must not inflate TEAM
      ]
    })
    expect(d.body).toMatch(/TEAM: 2 outreach/)
  })

  it('computes reply rate and week-over-week deltas', () => {
    const d = digest({
      outreach: [
        outreach('aum', LAST.mid, 'replied'),
        outreach('aum', LAST.mid),
        outreach('aum', LAST.mid),
        outreach('aum', LAST.mid),
        outreach('aum', PREV.mid), // prior week: 1 outreach, 0 replies
      ]
    })
    // 4 this week vs 1 last week, 1 reply of 4 = 25%
    expect(d.body).toMatch(/TEAM: 4 outreach \(▲3\)/)
    expect(d.body).toMatch(/1 replies \(25% rate, ▲1\)/)
  })

  it('does not divide by zero on a week with no outreach', () => {
    const d = digest()
    expect(d.body).toMatch(/TEAM: 0 outreach \(±0\)/)
    expect(d.body).toMatch(/0 replies \(0% rate/)
    expect(d.body).toContain('No outreach logged by anyone last week.')
  })

  it('ignores rows outside both weeks', () => {
    const d = digest({ outreach: [outreach('aum', '2026-06-01')] })
    expect(d.body).toMatch(/TEAM: 0 outreach/)
  })

  it('counts meetings by date-only prefix of a timestamp', () => {
    const d = digest({
      meetings: [{ logged_by: 'aum', activity_date: `${LAST.mid}T09:30:00Z` }]
    })
    expect(d.body).toMatch(/1 meetings/)
  })

  it('sorts analysts by outreach descending', () => {
    const d = digest({
      outreach: [
        outreach('gaurav', LAST.mid),
        outreach('gaurav', LAST.mid),
        outreach('aum', LAST.mid)
      ]
    })
    expect(d.body.indexOf('Gaurav:')).toBeLessThan(d.body.indexOf('Aum:'))
  })
})
