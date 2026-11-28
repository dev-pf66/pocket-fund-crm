// The snooze menu is one list shared by Today, Today's bulk bar and
// Notifications (Dev, 2026-11-28: "add more options to the snooze").
import { describe, it, expect } from 'vitest'
import { snoozeOptions } from '../src/lib/snoozeOptions.js'

describe('snoozeOptions', () => {
  it('offers short and long relative options', () => {
    const days = snoozeOptions('2026-11-28').filter(o => o.days).map(o => o.days)
    expect(days).toEqual([1, 3, 7, 14, 30, 91, 182])
  })

  it('every option is either relative days or an exact date after today', () => {
    for (const today of ['2026-11-28', '2026-12-31', '2027-03-01', '2027-10-15']) {
      for (const o of snoozeOptions(today)) {
        expect(!!o.days !== !!o.date).toBe(true)
        if (o.date) expect(o.date > today).toBe(true)
      }
    }
  })

  it('in November it offers the new year, landing on the first working day of January', () => {
    const ny = snoozeOptions('2026-11-28').find(o => o.key === 'ny')
    expect(ny).toMatchObject({ label: 'Start of 2027', date: '2027-01-04' })
    expect(snoozeOptions('2026-11-28').find(o => o.key === 'som')).toMatchObject({ label: 'Start of December', date: '2026-12-01' })
  })

  it('in December "Start of January" already covers it — no duplicate', () => {
    const opts = snoozeOptions('2026-12-10')
    expect(opts.find(o => o.key === 'ny')).toBeUndefined()
    expect(opts.find(o => o.key === 'som')).toMatchObject({ label: 'Start of January', date: '2027-01-04' })
  })

  it('keys are unique (they key the React list)', () => {
    const keys = snoozeOptions('2026-10-20').map(o => o.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
