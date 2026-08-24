// Guardrails for the Monday digest's accountability rules.
//
// Three of these encode explicit calls from Dev that a well-meaning refactor
// would undo: EVERY non-archived person appears with zeros included (a silent
// week has to be visible), the TEAM line sums only the rows it prints
// (summing every entry pulled in departed analysts, so the total didn't match
// the rows underneath it), and the digest leads with OUTCOMES not volume
// (Aug 2026 — sales went deliberately low-volume/high-targeting, so ranking by
// send count reported the new strategy as a decline).

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

  it('names every non-archived person, silent ones included', () => {
    // Dev's call, July 2026 — the digest is the accountability view, so an
    // analyst who did nothing must still appear by name. Aug 2026: they appear
    // in a single collapsed line rather than a row of zeros each.
    const d = digest({ outreach: [outreach('aum', LAST.mid)] })
    expect(d.body).toContain('Aum:')
    expect(d.body).toMatch(/No activity \(2\): Gaurav, Quiet Analyst/)
  })

  it('gives anyone who logged work their own row, outcome or not', () => {
    // Touches with no reply yet is real work, not silence — it must not be
    // collapsed into the no-activity line.
    const d = digest({ outreach: [outreach('gaurav', LAST.mid), outreach('gaurav', LAST.mid)] })
    expect(d.body).toMatch(/Gaurav: 0 meetings .* 0 replies \(0% of 2 touches/)
    expect(d.body).not.toMatch(/No activity[^\n]*Gaurav/)
  })

  it('collapses the whole roster when nobody did anything', () => {
    const d = digest()
    expect(d.body).toMatch(/No activity \(3\): Aum, Gaurav, Quiet Analyst/)
    expect(d.body).not.toContain('Aum:')
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
    // Same rule as before, now on the Volume line: the archived analyst's
    // touch must not be counted.
    expect(d.body).toMatch(/Volume: 2 outreach/)
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
    expect(d.body).toMatch(/1 replies \(25% of 4 touches, ▲1\)/)
    expect(d.body).toMatch(/Volume: 4 outreach \(▲3\)/)
  })

  it('does not divide by zero on a week with no outreach', () => {
    const d = digest()
    expect(d.body).toMatch(/Volume: 0 outreach \(±0\)/)
    expect(d.body).toMatch(/0 replies \(0% of 0 touches/)
    expect(d.body).toContain('Nothing moved last week')
  })

  it('ignores rows outside both weeks', () => {
    const d = digest({ outreach: [outreach('aum', '2026-06-01')] })
    expect(d.body).toMatch(/Volume: 0 outreach/)
  })

  it('counts meetings by date-only prefix of a timestamp', () => {
    const d = digest({
      meetings: [{ logged_by: 'aum', activity_date: `${LAST.mid}T09:30:00Z` }]
    })
    expect(d.body).toMatch(/1 meetings/)
  })

  it('ranks by outcomes, not send volume', () => {
    // Dev's call, Aug 2026. Gaurav sent 4x more; Aum booked the meeting and
    // got the reply. Aum ranks first — that is the whole point of the change.
    const d = digest({
      outreach: [
        outreach('gaurav', LAST.mid),
        outreach('gaurav', LAST.mid),
        outreach('gaurav', LAST.mid),
        outreach('gaurav', LAST.mid),
        outreach('aum', LAST.mid, 'replied')
      ],
      meetings: [{ logged_by: 'aum', activity_date: `${LAST.mid}T09:30:00Z` }]
    })
    expect(d.body.indexOf('Aum:')).toBeLessThan(d.body.indexOf('Gaurav:'))
    expect(d.body).not.toMatch(/No activity[^\n]*Gaurav/) // he worked, just no outcome
  })

  it('leads with what moved, and demotes volume to its own line', () => {
    const d = digest({
      outreach: [outreach('aum', LAST.mid, 'replied'), outreach('aum', LAST.mid)],
      meetings: [{ logged_by: 'aum', activity_date: `${LAST.mid}T09:30:00Z` }]
    })
    expect(d.body).toContain('TEAM — what moved:')
    expect(d.body.indexOf('what moved')).toBeLessThan(d.body.indexOf('Volume:'))
    expect(d.body).toMatch(/TEAM — what moved: 1 meetings/)
  })

  it('stays quiet about low volume when outcomes still happened', () => {
    // Low send count is the plan now — only a week where NOTHING moved is
    // worth flagging.
    const d = digest({
      outreach: [outreach('aum', LAST.mid, 'replied')],
      meetings: [{ logged_by: 'aum', activity_date: `${LAST.mid}T09:30:00Z` }]
    })
    expect(d.body).not.toContain('Nothing moved last week')
  })
})
