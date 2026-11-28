// The snooze menu (Dev, 2026-11-28: "add more options to the snooze"). One list
// for every surface — the Today row, Today's bulk bar, Notifications — so the
// choices never drift apart again (Today offered 1/3/7 days, Notifications
// 1d/1w/30d, the lead page five more).
//
// Two kinds of option:
//   { days }  — relative. Goes through snoozeFollowUp, which defers from the
//               later of today or the date already set (never drags it back).
//   { date }  — an exact day ("Next Monday", "Start of next month"). Goes
//               through snoozeFollowUpTo, which sets exactly that date.
// Pure; pinned by test/snooze-options.test.js.

import { nextMonday, startOfMonth } from './reminderParse.js'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']

export function snoozeOptions(today) {
  const t = new Date(today + 'T12:00:00Z')
  const year = t.getUTCFullYear()
  const month = t.getUTCMonth()
  const nm = (month + 1) % 12
  const nmYear = month === 11 ? year + 1 : year

  const options = [
    { key: '1d', label: 'Tomorrow', days: 1 },
    { key: '3d', label: '3 days', days: 3 },
    { key: '1w', label: '1 week', days: 7 },
    { key: '2w', label: '2 weeks', days: 14 },
    { key: '1m', label: '1 month', days: 30 },
    { key: '3m', label: '3 months', days: 91 },
    { key: '6m', label: '6 months', days: 182 },
    { key: 'mon', label: 'Next Monday', date: nextMonday(today), divider: true },
    { key: 'som', label: `Start of ${MONTH_NAMES[nm]}`, date: startOfMonth(nmYear, nm) }
  ]
  // The new year is a real answer from October on ("after the holidays",
  // "next year's budget") — Dev's own example. Earlier in the year it is just
  // a far-off date; Pick a date covers it. In December it would duplicate
  // "Start of January", so it is left out there.
  if (month >= 9 && month < 11) {
    options.push({ key: 'ny', label: `Start of ${year + 1}`, date: startOfMonth(year + 1, 0) })
  }
  return options
}
