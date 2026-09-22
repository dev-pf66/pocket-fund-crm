// Guardrails for the per-person daily output grid.
//
// The grid answers "did each person show up today", and the two ways it can
// lie are both silent: dropping unclaimed work (the team looks idle on days
// they worked) and dropping people with no calls (the person worth asking
// about vanishes from the report).

import { describe, it, expect } from 'vitest'
import { istAddDays } from '../src/lib/dateUtils'

// Mirrors the shaping logic in getDailyCallOutput. Kept in the test rather
// than exported because the real function is a DB read; this pins the rules
// that shape its output.
function shape(calls, people, days) {
  const nameById = new Map(people.filter(p => !p.is_archived).map(p => [p.id, p.name]))
  const buckets = new Map()
  const bucketFor = (key, name) => {
    if (!buckets.has(key)) buckets.set(key, { key, name, byDay: new Map(), total: 0 })
    return buckets.get(key)
  }
  for (const c of calls) {
    const key = c.logged_by == null ? 'unclaimed' : c.logged_by
    const name = key === 'unclaimed' ? 'Unclaimed' : (nameById.get(c.logged_by) || 'Former teammate')
    const b = bucketFor(key, name)
    b.byDay.set(c.outreach_date, (b.byDay.get(c.outreach_date) || 0) + 1)
    b.total += 1
  }
  for (const [id, name] of nameById) bucketFor(id, name)
  const rows = [...buckets.values()]
    .map(b => ({
      ...b,
      daily: days.map(d => b.byDay.get(d) || 0),
      activeDays: days.filter(d => (b.byDay.get(d) || 0) > 0).length,
    }))
    .sort((a, b) => {
      if (a.key === 'unclaimed') return 1
      if (b.key === 'unclaimed') return -1
      return b.total - a.total
    })
  return { rows, totals: days.map((_, i) => rows.reduce((s, r) => s + r.daily[i], 0)) }
}

const D0 = '2026-09-20'
const days = [D0, istAddDays(D0, 1), istAddDays(D0, 2)]
const people = [
  { id: 1, name: 'Aum', is_archived: false },
  { id: 2, name: 'Gaurav', is_archived: false },
  { id: 9, name: 'Departed', is_archived: true },
]

describe('daily output grid', () => {
  it('keeps unclaimed calls as their own row instead of dropping them', () => {
    // Everyone shares one CallHippo seat, so most imported dials have no
    // owner. Excluding them reports a working team as idle.
    const { rows } = shape(
      [{ logged_by: null, outreach_date: D0 }, { logged_by: null, outreach_date: D0 }],
      people, days
    )
    const unclaimed = rows.find(r => r.key === 'unclaimed')
    expect(unclaimed.total).toBe(2)
  })

  it('sorts Unclaimed last — it is a data-quality row, not a person', () => {
    const { rows } = shape(
      [{ logged_by: null, outreach_date: D0 }, { logged_by: null, outreach_date: D0 },
       { logged_by: 1, outreach_date: D0 }],
      people, days
    )
    // Even though it has the most calls, it must not top the leaderboard.
    expect(rows[rows.length - 1].key).toBe('unclaimed')
  })

  it('shows people with zero calls — the blank row IS the signal', () => {
    const { rows } = shape([{ logged_by: 1, outreach_date: D0 }], people, days)
    const gaurav = rows.find(r => r.name === 'Gaurav')
    expect(gaurav).toBeDefined()
    expect(gaurav.total).toBe(0)
    expect(gaurav.daily).toEqual([0, 0, 0])
  })

  it('hides archived teammates but keeps their calls visible', () => {
    // The person is off the roster; the work still happened.
    const { rows, totals } = shape([{ logged_by: 9, outreach_date: D0 }], people, days)
    expect(rows.find(r => r.name === 'Departed')).toBeUndefined()
    expect(rows.find(r => r.name === 'Former teammate').total).toBe(1)
    expect(totals[0]).toBe(1)
  })

  it('distinguishes a burst from steady work — the whole point of the grid', () => {
    // Both people make 6 calls. The scorecard averages them identically.
    const burst = [0, 1, 2].map(() => null).flatMap((_, i) =>
      i === 0 ? Array.from({ length: 6 }, () => ({ logged_by: 1, outreach_date: D0 })) : [])
    const steady = days.flatMap(d => [
      { logged_by: 2, outreach_date: d }, { logged_by: 2, outreach_date: d },
    ])
    const { rows } = shape([...burst, ...steady], people, days)
    const a = rows.find(r => r.name === 'Aum')
    const g = rows.find(r => r.name === 'Gaurav')
    expect(a.total).toBe(6)
    expect(g.total).toBe(6)
    // Same total, completely different shape.
    expect(a.activeDays).toBe(1)
    expect(g.activeDays).toBe(3)
    expect(a.daily).toEqual([6, 0, 0])
    expect(g.daily).toEqual([2, 2, 2])
  })

  it('team totals reconcile with the rows above them', () => {
    const calls = [
      { logged_by: 1, outreach_date: D0 },
      { logged_by: 2, outreach_date: D0 },
      { logged_by: null, outreach_date: D0 },
      { logged_by: 1, outreach_date: days[2] },
    ]
    const { rows, totals } = shape(calls, people, days)
    expect(totals[0]).toBe(3)
    expect(totals[2]).toBe(1)
    // A column that doesn't add up is how a report loses trust.
    for (let i = 0; i < days.length; i += 1) {
      expect(totals[i]).toBe(rows.reduce((s, r) => s + r.daily[i], 0))
    }
  })
})
