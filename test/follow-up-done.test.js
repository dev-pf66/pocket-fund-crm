// Guardrail: every way of completing a follow-up counts as "F/U done".
//
// The scoreboard counts an activity whose note starts `Followed up`. Until
// 2026-11-15 two completions slipped past it:
//   - Touched on the Today tab, on a lead with a follow-up due, wrote
//     `Touched (Today tab)` — it cleared the reminder but counted nowhere,
//     while the same lead cleared with Reached out on Notifications counted.
//     Dev's call: a follow-up handled with Touched IS a follow-up done.
//   - Reached out with a typed note wrote the bare note, no prefix.
// Only a touch that completes a DUE follow-up counts: date today or earlier, or
// the row came from Today's "Follow-ups due" section. A touch before the date
// (an early ping, a bulk touch on the board) or on a lead with no follow-up
// must not count — that would credit follow-ups weeks before they happen.

import { describe, it, expect } from 'vitest'
import { touchNote, isDueFollowUpTouch } from '../src/lib/api/today.js'
import { followUpNote } from '../src/lib/api/followups.js'
import { isFollowUpDoneNote } from '../src/lib/api/scoreboard.js'

// Fixed "today" so the test never depends on the clock.
const TODAY = '2026-11-15'

describe('F/U done: writers and the scoreboard agree', () => {
  const overdue = { id: 1, next_follow_up_date: '2026-11-10' }
  const dueToday = { id: 2, next_follow_up_date: TODAY }
  const cadenceStepDue = { id: 3, next_follow_up_date: '2026-11-14', follow_up_cadence: { offsets: [3, 7] } }
  const future = { id: 4, next_follow_up_date: '2026-12-20' }
  const futureCadence = { id: 5, next_follow_up_date: '2026-12-01', follow_up_cadence: { offsets: [3, 7] } }
  const none = { id: 6, next_follow_up_date: null, follow_up_cadence: null }

  it('Touched on a due or overdue follow-up counts', () => {
    for (const lead of [overdue, dueToday, cadenceStepDue]) {
      expect(isFollowUpDoneNote(touchNote(lead, '', 'Today tab', {}, TODAY))).toBe(true)
      expect(isFollowUpDoneNote(touchNote(lead, 'sent the samples', 'Today tab', {}, TODAY))).toBe(true)
    }
  })

  it("Touched on a row from Today's Follow-ups due section counts, even with no date (day 3/7/14 marks)", () => {
    expect(isDueFollowUpTouch(none, { followUp: true }, TODAY)).toBe(true)
    expect(isFollowUpDoneNote(touchNote(none, '', 'Today tab', { followUp: true }, TODAY))).toBe(true)
  })

  it('Touched BEFORE the follow-up is due does NOT count (early ping, bulk touch on the board)', () => {
    for (const lead of [future, futureCadence]) {
      expect(isFollowUpDoneNote(touchNote(lead, '', 'Pipeline board', {}, TODAY))).toBe(false)
    }
  })

  it('Touched on a lead with no follow-up does NOT count', () => {
    expect(isFollowUpDoneNote(touchNote(none, '', 'Today tab', {}, TODAY))).toBe(false)
    expect(isFollowUpDoneNote(touchNote(none, 'quick hello', 'Today tab', {}, TODAY))).toBe(false)
    expect(touchNote(none, '', 'Today tab', {}, TODAY)).toBe('Touched (Today tab)')
  })

  it('the note still says it was a touch, and keeps the typed note', () => {
    expect(touchNote(overdue, 'sent the samples', 'Today tab', {}, TODAY)).toBe('Followed up (touched) — sent the samples')
    expect(touchNote(overdue, '', 'Pipeline board', {}, TODAY)).toBe('Followed up (touched, Pipeline board)')
  })

  it('Reached out always counts, with or without a typed note', () => {
    expect(isFollowUpDoneNote(followUpNote(overdue))).toBe(true)
    expect(isFollowUpDoneNote(followUpNote({ follow_up_note: 'Send sample deals' }))).toBe(true)
    expect(isFollowUpDoneNote(followUpNote(overdue, 'called, no answer'))).toBe(true)
    expect(followUpNote(overdue, 'called, no answer')).toBe('Followed up — called, no answer')
  })

  it('unrelated notes do not count', () => {
    for (const n of ['Lead created in CRM', 'Touched (Today tab)', 'followed up later', '', null]) {
      expect(isFollowUpDoneNote(n)).toBe(false)
    }
  })
})
