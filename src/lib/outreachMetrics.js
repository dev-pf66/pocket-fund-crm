// Shared outreach gamification math — used by the Outreach Log dashboard
// and the main Dashboard's "My Week" block. All dates are IST calendar
// days (see dateUtils.js).

import { istToday, istAddDays, istWeekStart } from './dateUtils'

// rows: [{ outreach_date, ... }] → Map<dateStr, count>
export function buildDailyCounts(rows) {
  const m = new Map()
  for (const r of rows) {
    m.set(r.outreach_date, (m.get(r.outreach_date) || 0) + 1)
  }
  return m
}

// Compute dashboard metrics from a person's daily count buckets.
export function computeMetrics(dailyCounts, dailyGoal = 10) {
  const today = istToday()
  const todayCount = dailyCounts.get(today) || 0

  // Streak: consecutive days meeting the daily goal. Include today if hit;
  // otherwise count backward from yesterday so a mid-day lull doesn't erase
  // the streak.
  let streak = 0
  let cursor = todayCount >= dailyGoal ? today : istAddDays(today, -1)
  while ((dailyCounts.get(cursor) || 0) >= dailyGoal) {
    streak += 1
    cursor = istAddDays(cursor, -1)
  }

  // Weekly: Mon-Sun ending this week.
  const thisWeekStart = istWeekStart(today)
  let thisWeekCount = 0
  for (let i = 0; i < 7; i += 1) {
    thisWeekCount += dailyCounts.get(istAddDays(thisWeekStart, i)) || 0
  }

  // Personal bests across the loaded window.
  let bestDay = { date: null, count: 0 }
  const weekBuckets = new Map()
  for (const [date, count] of dailyCounts) {
    if (count > bestDay.count) bestDay = { date, count }
    const ws = istWeekStart(date)
    weekBuckets.set(ws, (weekBuckets.get(ws) || 0) + count)
  }
  let bestWeek = { start: null, count: 0 }
  for (const [start, count] of weekBuckets) {
    if (count > bestWeek.count) bestWeek = { start, count }
  }

  return { todayCount, streak, thisWeekCount, bestDay, bestWeek, thisWeekStart }
}

// Career milestone tiers for the badge on the Dashboard. Returns the tier
// the person has reached and how far to the next one.
const MILESTONES = [
  { at: 100,  label: '100 Club',   color: '#b45309' },
  { at: 250,  label: '250 Club',   color: '#6b7280' },
  { at: 500,  label: '500 Club',   color: '#d97706' },
  { at: 1000, label: '1K Club',    color: '#7c3aed' },
  { at: 2500, label: '2.5K Club',  color: '#16a34a' }
]

export function milestoneFor(careerTotal) {
  let reached = null
  let next = null
  for (const m of MILESTONES) {
    if (careerTotal >= m.at) reached = m
    else { next = m; break }
  }
  return { reached, next, toNext: next ? next.at - careerTotal : 0 }
}
