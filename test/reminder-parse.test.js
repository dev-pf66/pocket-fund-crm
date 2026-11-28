// Typed reminders (Dev, 2026-11-28): "I can type in 'reach out in the start of
// the new year' and then it pops up on Today in Jan." Pins what the local
// parser reads, so a phrase that worked keeps landing on the same day.
// Anything it can't read must return null (→ Claude), never a guess.
import { describe, it, expect } from 'vitest'
import { parseReminder, nextWorkday, startOfMonth } from '../src/lib/reminderParse.js'

const SAT = '2026-11-28' // a Saturday
const MON = '2026-11-30'
const date = (text, today = SAT) => parseReminder(text, today)?.date ?? null

describe('parseReminder — the phrase Dev asked for', () => {
  it('"reach out in the start of the new year" lands on the first working day of January', () => {
    // Jan 1 is skipped; Jan 2 2027 is a Saturday → Monday Jan 4.
    expect(date('reach out in the start of the new year')).toBe('2027-01-04')
    expect(date('new year')).toBe('2027-01-04')
    expect(date('after the new year')).toBe('2027-01-04')
    expect(date('early next year')).toBe('2027-01-04')
    expect(date('January')).toBe('2027-01-04')
    expect(date('in jan')).toBe('2027-01-04')
  })
})

describe('parseReminder — relative', () => {
  it('reads counts of days/weeks/months, moving weekends to Monday', () => {
    expect(date('tomorrow')).toBe('2026-11-29')
    expect(date('in 3 days')).toBe('2026-12-01')
    expect(date('in 2 weeks')).toBe('2026-12-14') // Sat Dec 12 → Mon Dec 14
    expect(date('a couple of weeks')).toBe('2026-12-14')
    expect(date('3 months')).toBe('2027-03-01') // Sun Feb 28 → Mon Mar 1
    expect(date('get back to me in six months')).toBe('2027-05-28')
    expect(date('next quarter')).toBe('2027-01-04')
  })

  it('"in 2-3 weeks" is not read as 2 March', () => {
    expect(date('in 2-3 weeks')).toBe('2026-12-21')
  })

  it('weeks and weekdays', () => {
    expect(date('next week')).toBe(MON)
    expect(date('friday')).toBe('2026-12-04')
    expect(date('next friday', MON)).toBe('2026-12-11')
    expect(date('monday', MON)).toBe('2026-12-07')
  })
})

describe('parseReminder — months and dates', () => {
  it('a month already passed means next year', () => {
    expect(date('march')).toBe('2027-03-01')
    expect(date('after march')).toBe('2027-04-01')
    expect(date('mid march')).toBe('2027-03-15')
    expect(date('end of march')).toBe('2027-03-31')
    expect(date('mid december')).toBe('2026-12-15')
    expect(date('next month')).toBe('2026-12-01')
    expect(date('end of next month')).toBe('2026-12-31')
    expect(date('Q2')).toBe('2027-04-01')
  })

  it('explicit dates, day first', () => {
    expect(date('jan 15')).toBe('2027-01-15')
    expect(date('15th of january')).toBe('2027-01-15')
    expect(date('15/1')).toBe('2027-01-15')
    expect(date('2027-02-10')).toBe('2027-02-10')
  })

  it('"end of year" means before the holidays, not Dec 31', () => {
    expect(date('end of the year')).toBe('2026-12-15')
  })

  it('"may" the verb is not the month', () => {
    expect(date('they may be ready later')).toBe(null)
    expect(date('early may')).toBe('2027-05-03')
  })
})

describe('parseReminder — never guesses', () => {
  it('returns null for what it cannot read, so Claude gets asked instead', () => {
    expect(date('after Diwali')).toBe(null)
    expect(date('when their fund closes')).toBe(null)
    expect(date('')).toBe(null)
  })

  it('never returns a date in the past or today', () => {
    expect(date('2026-11-01')).toBe(null)
    for (const p of ['tomorrow', 'next week', 'march', 'jan 15', 'friday', 'end of the year', 'next month']) {
      expect(date(p) > SAT).toBe(true)
    }
  })
})

describe('helpers', () => {
  it('nextWorkday skips weekends; January starts on the 2nd at the earliest', () => {
    expect(nextWorkday('2026-11-28')).toBe('2026-11-30')
    expect(startOfMonth(2028, 0)).toBe('2028-01-03') // Jan 2 2028 is a Sunday
  })
})
