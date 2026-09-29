// Guardrails for the required-info flag and the running 30-day clock.
//
// Both encode rulings from Dev (Sept 2026) that the code cannot state for
// itself, and both fail in the direction of being annoying rather than wrong —
// which is how a flag gets switched off entirely.
//
//  1. THE FLAG IS NOT A GATE. Nothing here blocks a save. "It will be a basic
//     flag if it's not all the info."
//  2. THE FLAG DOES NOT APPLY TO COLD LEADS. 446 of 556 live leads sit at
//     `outreach`. Flagging all of them for having no thesis would mean 80% of
//     the book is flagged, and a flag that is always on is not a flag.
//  3. THE CLOCK IS A RUNNING CLOCK — a rolling window from the last touch that
//     resets when the lead is worked, not a one-shot deadline. The old
//     day-3/7/14 exact-match pattern is why 179 engaged leads scored nothing,
//     and this must not reproduce it.
//  4. A SCHEDULED FOLLOW-UP OUTRANKS THE DATE. Someone saying "I am on this"
//     beats a heuristic, and the archive sweep already agrees — two surfaces
//     disagreeing about whether a lead is abandoned makes both untrustworthy.

import { describe, it, expect } from 'vitest'
import {
  REQUIRED_LEAD_FIELDS, STALE_BREACH_DAYS, INFO_REQUIRED_FROM_STAGE,
  infoRequiredFor, missingRequiredFields, requiredFieldsFor, isMissingInfo,
  isUnreachable, daysSinceTouch, isStaleBreach, leadBreaches, hasAnyBreach
} from '../src/lib/leadHealth.js'

const NOW = new Date('2026-09-27T12:00:00+05:30')
const TODAY = '2026-09-27'
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString()

/** An engaged lead with every required field filled in. */
const complete = (over = {}) => ({
  id: 1,
  stage: 'responded',
  is_archived: false,
  last_activity_date: daysAgo(1),
  next_follow_up_date: null,
  // A contact method is required from `responded` — see the "reachable" block.
  linkedin_url: 'https://linkedin.com/in/someone',
  lead_type: 'PE Firm',
  buying_timeline: 'Buying in 0-3 months',
  lead_channel: 'Inbound — YouTube',
  investment_thesis: 'B2B SaaS, $2-10M',
  prior_acquisitions: 'Two, both SaaS',
  engagement_model: 'Success fee',
  ...over
})

// ============================================================================
// REQUIRED INFO
// ============================================================================

describe('the required-info flag', () => {
  it('is clean when every field is filled', () => {
    expect(missingRequiredFields(complete())).toEqual([])
    expect(isMissingInfo(complete())).toBe(false)
  })

  it('names exactly what is missing, so the flag is actionable', () => {
    const missing = missingRequiredFields(
      complete({ stage: 'meeting_booked', lead_channel: null, engagement_model: '' }))
    expect(missing.map(f => f.key).sort()).toEqual(['engagement_model', 'lead_channel'])
    // The label is what a human is asked — it must survive, not just the column.
    expect(missing.every(f => typeof f.label === 'string' && f.label.length > 0)).toBe(true)
  })

  it('does NOT apply to a cold outreach lead — nobody has spoken to them yet', () => {
    const cold = { stage: 'outreach', is_archived: false }
    expect(infoRequiredFor(cold)).toBe(false)
    expect(missingRequiredFields(cold)).toEqual([])
    expect(isMissingInfo(cold)).toBe(false)
  })

  it('applies from the moment someone replies, and at every stage after', () => {
    for (const stage of INFO_REQUIRED_FROM_STAGE) {
      expect(infoRequiredFor({ stage, is_archived: false })).toBe(true)
    }
    expect(INFO_REQUIRED_FROM_STAGE).not.toContain('outreach')
  })

  it('never flags an archived lead — it is parked, not pending', () => {
    expect(isMissingInfo({ stage: 'warm_active', is_archived: true })).toBe(false)
  })

  it('treats whitespace as unanswered', () => {
    expect(isMissingInfo(complete({ stage: 'meeting_booked', investment_thesis: '   ' }))).toBe(true)
  })

  it('accepts a non-string value as answered — a 0 or false is still an answer', () => {
    expect(isMissingInfo(complete({ prior_acquisitions: 0 }))).toBe(false)
  })

  it('keeps the list short — a flag that is always on is not a flag', () => {
    expect(REQUIRED_LEAD_FIELDS.length).toBeLessThanOrEqual(8)
  })
})

// ============================================================================
// THE TWO TIERS
// ============================================================================
//
// Dev's words: "a minimum amount of information for a lead once you're putting
// it in MeetingBooked". Requiring all six from `responded` flagged 115 of 116
// engaged leads — measured, not guessed — and a flag on 99% of the book tells
// nobody anything. Channel and buyer type are required a stage earlier because
// they are answerable from the reply and they are what the inbound-vs-outbound
// question needs; the other four wait for the meeting.

describe('the two tiers', () => {
  it('asks a replied lead for a contact method plus the two answerable-from-a-reply fields', () => {
    const fields = requiredFieldsFor({ stage: 'responded', is_archived: false })
    expect(fields.map(f => f.key).sort()).toEqual(['contact', 'lead_channel', 'lead_type'])
  })

  it('asks for all six once the meeting is booked, and at every stage after', () => {
    for (const stage of ['meeting_booked', 'warm_active', 'client']) {
      expect(requiredFieldsFor({ stage, is_archived: false })).toHaveLength(REQUIRED_LEAD_FIELDS.length)
    }
  })

  it('asks a cold lead for nothing', () => {
    expect(requiredFieldsFor({ stage: 'outreach', is_archived: false })).toEqual([])
  })

  it('leaves a replied lead clean when it is reachable and has channel and type', () => {
    const replied = {
      stage: 'responded', is_archived: false,
      email: 'them@firm.com',
      lead_channel: 'Inbound — YouTube', lead_type: 'PE Firm',
      investment_thesis: null, buying_timeline: null,
      prior_acquisitions: null, engagement_model: null
    }
    expect(isMissingInfo(replied)).toBe(false)
  })

  it('flags that same lead the moment it reaches meeting_booked', () => {
    const booked = {
      stage: 'meeting_booked', is_archived: false,
      email: 'them@firm.com',
      lead_channel: 'Inbound — YouTube', lead_type: 'PE Firm',
      investment_thesis: null, buying_timeline: null,
      prior_acquisitions: null, engagement_model: null
    }
    expect(isMissingInfo(booked)).toBe(true)
    expect(missingRequiredFields(booked).map(f => f.key).sort())
      .toEqual(['buying_timeline', 'engagement_model', 'investment_thesis', 'prior_acquisitions'])
  })

  it('flags a replied lead that never recorded how it found us', () => {
    // lead_channel has never been filled for anyone, which is the gap the channel
    // question exists for.
    expect(isMissingInfo({
      stage: 'responded', is_archived: false, lead_type: 'PE Firm', email: 'a@b.com'
    })).toBe(true)
  })
})

// ============================================================================
// REACHABLE AT ALL
// ============================================================================
//
// Measured 2026-09-29 against production: of 56 leads at `responded` — people who
// had ALREADY REPLIED to us — 10 had no email, no phone and no LinkedIn URL, and
// ZERO of the 56 had an email. One of the 12 leads with a booked meeting was
// unreachable too. Qualification data is nice; a contact method is the difference
// between a lead and a name, which is why it is required first.

describe('a way to reach them', () => {
  it.each([
    ['email', { email: 'them@firm.com' }],
    ['phone', { phone: '+91 98765 43210' }],
    ['linkedin', { linkedin_url: 'https://linkedin.com/in/them' }],
  ])('is satisfied by %s alone — we do not insist on a particular one', (_label, over) => {
    const lead = { stage: 'responded', is_archived: false, lead_type: 'X', lead_channel: 'Y', ...over }
    expect(missingRequiredFields(lead).map(f => f.key)).not.toContain('contact')
    expect(isUnreachable(lead)).toBe(false)
  })

  it('flags a replied lead with no contact method at all', () => {
    const lead = { stage: 'responded', is_archived: false, lead_type: 'X', lead_channel: 'Y' }
    expect(missingRequiredFields(lead).map(f => f.key)).toContain('contact')
    expect(isUnreachable(lead)).toBe(true)
  })

  it('treats a whitespace-only contact as no contact', () => {
    expect(isUnreachable({ email: '  ', phone: '', linkedin_url: null })).toBe(true)
  })

  it('does not ask a cold lead for a contact method', () => {
    // 446 leads sit at `outreach`; demanding contact details there would flag most
    // of the book and mean nothing.
    expect(requiredFieldsFor({ stage: 'outreach', is_archived: false })).toEqual([])
  })

  it('is the first thing asked for, because it is the one that stops work dead', () => {
    expect(REQUIRED_LEAD_FIELDS[0].key).toBe('contact')
  })
})

// ============================================================================
// THE RUNNING CLOCK
// ============================================================================

describe('the running 30-day clock', () => {
  it('is 30 days', () => {
    expect(STALE_BREACH_DAYS).toBe(30)
  })

  it('breaches at 30 days and stays breached — it is continuous, not an exact day', () => {
    // The bug this guards: marks.has(daysStale) pinged on day 3/7/14 exactly and
    // then went silent forever.
    for (const d of [30, 31, 45, 90, 400]) {
      expect(isStaleBreach({ stage: 'responded', last_activity_date: daysAgo(d) }, { today: TODAY, now: NOW }))
        .toBe(true)
    }
  })

  it('is clean before the window closes', () => {
    for (const d of [0, 1, 15, 29]) {
      expect(isStaleBreach({ stage: 'responded', last_activity_date: daysAgo(d) }, { today: TODAY, now: NOW }))
        .toBe(false)
    }
  })

  it('resets when the lead is touched — that is what "running" means', () => {
    const lead = { stage: 'responded', last_activity_date: daysAgo(90) }
    expect(isStaleBreach(lead, { today: TODAY, now: NOW })).toBe(true)
    const touched = { ...lead, last_activity_date: daysAgo(0) }
    expect(isStaleBreach(touched, { today: TODAY, now: NOW })).toBe(false)
  })

  it('spares a lead with a follow-up scheduled from today onward, however stale', () => {
    for (const date of [TODAY, '2026-12-01']) {
      expect(isStaleBreach(
        { stage: 'responded', last_activity_date: daysAgo(300), next_follow_up_date: date },
        { today: TODAY, now: NOW }
      )).toBe(false)
    }
  })

  it('still breaches when the scheduled follow-up is itself in the past', () => {
    expect(isStaleBreach(
      { stage: 'responded', last_activity_date: daysAgo(60), next_follow_up_date: '2026-08-01' },
      { today: TODAY, now: NOW }
    )).toBe(true)
  })

  it('never breaches a client, a passed lead, or an archived lead', () => {
    for (const over of [{ stage: 'client' }, { stage: 'passed' }, { stage: 'responded', is_archived: true }]) {
      expect(isStaleBreach({ last_activity_date: daysAgo(400), ...over }, { today: TODAY, now: NOW }))
        .toBe(false)
    }
  })

  it('ages an untouched import off created_at, so it cannot be immortal', () => {
    expect(isStaleBreach(
      { stage: 'responded', last_activity_date: null, created_at: daysAgo(120) },
      { today: TODAY, now: NOW }
    )).toBe(true)
  })

  it('reports unknown rather than fresh when there is no date at all', () => {
    expect(daysSinceTouch({ last_activity_date: null, created_at: null })).toBeNull()
    expect(isStaleBreach({ stage: 'responded' }, { today: TODAY, now: NOW })).toBe(false)
  })
})

// ============================================================================
// THE COMBINED BADGE
// ============================================================================

describe('leadBreaches', () => {
  it('reports a missing transcript once a lead has reached the meeting stage', () => {
    const b = leadBreaches(complete({ stage: 'meeting_booked' }), { hasTranscript: false })
    expect(b.needsTranscript).toBe(true)
    expect(hasAnyBreach(b)).toBe(true)
  })

  it('does not want a transcript from a lead that has only replied', () => {
    expect(leadBreaches(complete({ stage: 'responded' }), { hasTranscript: false }).needsTranscript).toBe(false)
  })

  it('never claims a transcript is missing when it was not checked', () => {
    // hasTranscript: null means "did not look" — reporting a breach from that
    // would be inventing a finding.
    expect(leadBreaches(complete({ stage: 'warm_active' }), {}).needsTranscript).toBe(false)
    expect(leadBreaches(complete({ stage: 'warm_active' }), { hasTranscript: null }).needsTranscript).toBe(false)
  })

  it('is fully clean for a healthy, recently-worked, complete lead', () => {
    const b = leadBreaches(complete({ stage: 'meeting_booked' }), { hasTranscript: true, today: TODAY, now: NOW })
    expect(hasAnyBreach(b)).toBe(false)
  })

  it('carries the stale day count so the UI can say how bad it is', () => {
    const b = leadBreaches(complete({ last_activity_date: daysAgo(47) }), { today: TODAY, now: NOW })
    expect(b.staleBreach).toBe(true)
    expect(b.staleDays).toBe(47)
  })
})
