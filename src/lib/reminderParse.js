// Typed reminders (Dev, 2026-11-28): "a manual way to give an update ... I can
// type in 'reach out in the start of the new year' and then it pops up on Today
// in Jan." This turns the phrase someone types after a conversation into a
// reminder date.
//
// Pure, import-free and deterministic, so it runs instantly in the browser and
// test/reminder-parse.test.js can pin it. Anything it can't read falls back to
// Claude (api/_reminder-ai.js); either way the UI shows the date it picked and
// lets you change it BEFORE anything is saved. A parser that guesses silently
// would put leads on the wrong day with nobody noticing.
//
// Dates are YYYY-MM-DD strings in IST, like every other date in this app
// (src/lib/dateUtils.js). `today` is passed in so tests are not time-bound.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december']
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const WEEKDAY_RE = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?'

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, 'a couple': 2,
  'a couple of': 2, few: 3, 'a few': 3
}

// ---- date helpers (UTC-noon arithmetic, same as dateUtils) -----------------

function d(str) { return new Date(str + 'T12:00:00Z') }
function iso(date) { return date.toISOString().split('T')[0] }
function ymd(y, m, day) { return iso(new Date(Date.UTC(y, m, day, 12))) }

export function addDays(str, n) {
  const x = d(str); x.setUTCDate(x.getUTCDate() + n); return iso(x)
}

/** Add calendar months, clamping the day (Jan 31 + 1 month → Feb 28). */
export function addMonths(str, n) {
  const x = d(str)
  const y = x.getUTCFullYear(), m = x.getUTCMonth() + n, day = x.getUTCDate()
  const last = new Date(Date.UTC(y, m + 1, 0, 12)).getUTCDate()
  return ymd(y, m, Math.min(day, last))
}

function weekday(str) { return d(str).getUTCDay() }

/** First Monday–Friday on or after `str`. A reminder on a Sunday is a Monday reminder. */
export function nextWorkday(str) {
  let x = str
  while (weekday(x) === 0 || weekday(x) === 6) x = addDays(x, 1)
  return x
}

/** Last Monday–Friday on or before `str`. */
function prevWorkday(str) {
  let x = str
  while (weekday(x) === 0 || weekday(x) === 6) x = addDays(x, -1)
  return x
}

/** First working day of a month. January skips the 1st — nobody is reachable on New Year's Day. */
export function startOfMonth(year, month) {
  return nextWorkday(ymd(year, month, month === 0 ? 2 : 1))
}

function midMonth(year, month) { return nextWorkday(ymd(year, month, 15)) }

function endOfMonth(year, month) {
  return prevWorkday(ymd(year, month + 1, 0))
}

/** The next Monday strictly after today. */
export function nextMonday(today) {
  const wd = weekday(today)
  return addDays(today, ((8 - wd) % 7) || 7)
}

/** Year in which `month` next comes round: this year if it hasn't passed, else next. */
function yearFor(month, today, { allowCurrent = true } = {}) {
  const t = d(today)
  const cur = t.getUTCMonth()
  if (month > cur || (allowCurrent && month === cur)) return t.getUTCFullYear()
  return t.getUTCFullYear() + 1
}

function monthIndex(word) {
  const w = word.toLowerCase().slice(0, 3)
  return MONTHS.findIndex(m => m.startsWith(w))
}

function weekdayIndex(word) {
  const w = word.toLowerCase().slice(0, 3)
  return WEEKDAYS.findIndex(x => x.startsWith(w))
}

function toNumber(word) {
  if (/^\d+$/.test(word)) return Number(word)
  return NUMBER_WORDS[word.toLowerCase().trim()] ?? null
}

// A date in the past is never an answer — "Jan 5" typed in March means next Jan 5.
function future(date, today) { return date > today ? date : null }

/**
 * Read a typed reminder.
 *
 * Returns { date, rule } — `rule` names what was understood, shown next to the
 * date so the person can see WHY that day was picked ("start of January") — or
 * null when the phrase isn't recognised (the caller then asks Claude).
 */
export function parseReminder(text, today) {
  if (!text || !today) return null
  const s = ` ${String(text).toLowerCase().replace(/[’']/g, '').replace(/[.,!?;]/g, ' ').replace(/\s+/g, ' ').trim()} `
  const t = d(today)
  const year = t.getUTCFullYear()
  const month = t.getUTCMonth()
  let m

  // ---- explicit dates first: they are unambiguous --------------------------
  if ((m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) {
    const date = ymd(+m[1], +m[2] - 1, +m[3])
    return future(date, today) ? { date, rule: 'that date' } : null
  }
  // dd/mm or dd/mm/yyyy — the team is in India, so day first. Slash only: a
  // dash would read "in 2-3 weeks" as 2 March.
  if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const day = +m[1], mon = +m[2] - 1
    if (mon >= 0 && mon < 12 && day >= 1 && day <= 31) {
      let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : year
      let date = ymd(y, mon, day)
      if (!m[3] && date <= today) date = ymd(y + 1, mon, day)
      return future(date, today) ? { date, rule: 'that date' } : null
    }
  }
  // "15 jan", "15th of january", "jan 15", "january 15th"
  if ((m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?: of)? ${MONTH_RE}\\b`))) ||
      (m = s.match(new RegExp(`\\b${MONTH_RE} (\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
    const [day, mon] = /^\d/.test(m[1]) ? [+m[1], monthIndex(m[2])] : [+m[2], monthIndex(m[1])]
    if (day >= 1 && day <= 31) {
      let date = ymd(year, mon, day)
      if (date <= today) date = ymd(year + 1, mon, day)
      return { date, rule: `${MONTHS[mon].replace(/^./, c => c.toUpperCase())} ${day}` }
    }
  }

  // ---- relative ------------------------------------------------------------
  if (/\b(tomorrow|tmrw|tmr)\b/.test(s)) return { date: addDays(today, 1), rule: 'tomorrow' }
  if (/\bday after tomorrow\b/.test(s)) return { date: addDays(today, 2), rule: 'day after tomorrow' }

  // ---- the new year ---------------------------------------------------------
  // "start of the new year", "new year", "next year", "after the new year",
  // "early next year", "beginning of next year", "first week of january"
  if (/\b(new year|next year|new yr|following year)\b/.test(s) && !/\bend of (the )?(next|new) year\b/.test(s)) {
    if (/\b(mid|middle of)\b/.test(s)) return { date: nextWorkday(ymd(year + 1, 5, 15)), rule: 'middle of next year' }
    return { date: startOfMonth(year + 1, 0), rule: 'start of the new year' }
  }
  if (/\b(end of (the )?year|year end|year-end|eoy|before the year ends|before year end)\b/.test(s)) {
    // Mid-December, not the 31st: "end of year" means before the holidays.
    const date = nextWorkday(ymd(year, 11, 15))
    return date > today ? { date, rule: 'mid-December, before the year ends' } : { date: startOfMonth(year + 1, 0), rule: 'start of the new year' }
  }

  // "in 3 weeks", "3 months", "a couple of weeks", "a few months", "6 months from now"
  if ((m = s.match(/\b(\d+|a couple of|a couple|couple|a few|few|an|a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (day|week|month|year|quarter)s?\b/))) {
    const n = toNumber(m[1])
    if (n) {
      const unit = m[2]
      const date = unit === 'day' ? addDays(today, n)
        : unit === 'week' ? addDays(today, 7 * n)
          : unit === 'month' ? addMonths(today, n)
            : unit === 'quarter' ? addMonths(today, 3 * n)
              : addMonths(today, 12 * n)
      return { date: nextWorkday(date), rule: `${n} ${unit}${n === 1 ? '' : 's'} from today` }
    }
  }
  if (/\bfortnight\b/.test(s)) return { date: nextWorkday(addDays(today, 14)), rule: '2 weeks from today' }
  if (/\b(half a year|six months)\b/.test(s)) return { date: nextWorkday(addMonths(today, 6)), rule: '6 months from today' }

  // ---- quarters ---------------------------------------------------------------
  if ((m = s.match(/\bq([1-4])\b/))) {
    const qMonth = (+m[1] - 1) * 3
    const y = qMonth > month ? year : year + 1
    return { date: startOfMonth(y, qMonth), rule: `start of Q${m[1]}` }
  }
  if (/\bnext quarter\b/.test(s)) {
    const qMonth = (Math.floor(month / 3) + 1) * 3
    return { date: startOfMonth(year + Math.floor(qMonth / 12), qMonth % 12), rule: 'start of next quarter' }
  }

  // ---- months -----------------------------------------------------------------
  // "next month", "start of next month", "mid next month", "end of next month"
  if (/\bnext month\b/.test(s)) {
    const nm = (month + 1) % 12, y = month === 11 ? year + 1 : year
    if (/\b(mid|middle)\b/.test(s)) return { date: midMonth(y, nm), rule: `mid ${MONTHS[nm]}` }
    if (/\b(end|late)\b/.test(s)) return { date: endOfMonth(y, nm), rule: `end of ${MONTHS[nm]}` }
    return { date: startOfMonth(y, nm), rule: `start of ${MONTHS[nm]}` }
  }
  if (/\b(end of (the|this) month|month end|month-end|later this month)\b/.test(s)) {
    const date = endOfMonth(year, month)
    if (date > today) return { date, rule: 'end of this month' }
  }

  // "after march" → start of April; "early/mid/end of march", "in march", "march"
  if ((m = s.match(new RegExp(`\\b(after|post) ${MONTH_RE}\\b`)))) {
    const mon = (monthIndex(m[2]) + 1) % 12
    return { date: startOfMonth(yearFor(mon, today, { allowCurrent: false }), mon), rule: `start of ${MONTHS[mon]}` }
  }
  if ((m = s.match(new RegExp(`\\b${MONTH_RE}\\b`)))) {
    // "may" is also a verb ("they may be ready") — only read it as the month
    // with a month-ish word around it.
    if (m[1] !== 'may' || new RegExp(`\\b(in|early|mid|end of|late|start of|beginning of|by|after|first week of) may\\b|\\bmay (start|end|first)\\b`).test(s)) {
      const mon = monthIndex(m[1])
      const mid = new RegExp(`\\b(mid|middle of|mid-) ?${MONTH_RE}`).test(s)
      const end = new RegExp(`\\b(end of|late|last week of) ${MONTH_RE}`).test(s)
      const y = yearFor(mon, today, { allowCurrent: mid || end })
      if (mid) { const date = midMonth(y, mon); if (date > today) return { date, rule: `mid ${MONTHS[mon]}` } }
      if (end) { const date = endOfMonth(y, mon); if (date > today) return { date, rule: `end of ${MONTHS[mon]}` } }
      const sy = yearFor(mon, today, { allowCurrent: false })
      return { date: startOfMonth(sy, mon), rule: `start of ${MONTHS[mon]}` }
    }
  }

  // ---- weeks and weekdays -----------------------------------------------------
  if (/\b(next week|following week|week after)\b/.test(s)) {
    if (/\bweek after next\b/.test(s)) return { date: addDays(nextMonday(today), 7), rule: 'Monday after next' }
    return { date: nextMonday(today), rule: 'next Monday' }
  }
  if (/\b(end of (the|this) week|later this week|eow)\b/.test(s)) {
    const fri = addDays(today, (5 - weekday(today) + 7) % 7)
    if (fri > today) return { date: fri, rule: 'this Friday' }
    return { date: nextMonday(today), rule: 'next Monday' }
  }
  if (/\bafter the weekend\b/.test(s)) return { date: nextMonday(today), rule: 'next Monday' }
  if ((m = s.match(new RegExp(`\\b(next |this |on |coming )?${WEEKDAY_RE}\\b`)))) {
    const target = weekdayIndex(m[2])
    if (target >= 0) {
      let diff = (target - weekday(today) + 7) % 7 || 7
      // "next friday" said on a Monday means the Friday of NEXT week, not this one.
      if (m[1]?.trim() === 'next' && diff < 7 && weekday(today) !== 0 && target > weekday(today)) diff += 7
      const date = addDays(today, diff)
      return { date, rule: `${m[1]?.trim() === 'next' ? 'next ' : ''}${WEEKDAYS[target].replace(/^./, c => c.toUpperCase())}` }
    }
  }

  return null
}
