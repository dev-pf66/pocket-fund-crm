// Guardrails for the CallHippo importer.
//
// The mapping was written against 53 real records from the account, and the
// facts it depends on are the kind that break silently: a timestamp field
// that vanishes on unanswered calls, a status vocabulary that grows, a phone
// format that stops matching. These pin the ones that would corrupt the
// funnel rather than throw.

import { describe, it, expect } from 'vitest'
import { phoneKey, callStartMs, isAnswered, mapCall } from '../api/callhippo-sync.js'

// A real Completed record, numbers changed. hangup − totalCallDuration
// reconstructs the start exactly: 14:14:00 − 86s = 14:12:34, +5s ring = the
// 14:12:39 answer time on the same record.
const answered = {
  _id: '6aa40c51bf95b95558c90834',
  callSid: 'CA20250c91f24971d394ecf734d1ef334d',
  callType: 'Outgoing',
  from: '+14155550100', to: '+16315550029',
  date: 'Sep 11, 2026', time: '7:42:32 PM',
  callDuration: '00:01:21', totalCallDuration: 86, ringingDuration: '00:00:05',
  caller: 'Dev Shah', callerEmail: 'hello@pocket-fund.com',
  callStatus: 'Completed',
  callAnswerTime: 'Fri Sep 11 2026 14:12:39 GMT+0000 (Coordinated Universal Time)',
  callHangupTime: 'Fri Sep 11 2026 14:14:00 GMT+0000 (Coordinated Universal Time)',
  recordingUrl: '', callNotes: '', crmUniqueId: '',
}

// Unanswered calls have NO callAnswerTime — only callHangupTime survives.
const noAnswer = {
  ...answered,
  _id: 'x2', callSid: 'CA00000000000000000000000000000002',
  callStatus: 'No Answer', totalCallDuration: 3, callDuration: '00:00:00',
  callAnswerTime: undefined,
  callHangupTime: 'Mon Sep 07 2026 14:45:18 GMT+0000 (Coordinated Universal Time)',
}

const leads = new Map([['6315550029', { id: 42, name: 'Ana Reyes', firm_name: 'Meridian' }]])

describe('phoneKey', () => {
  it('matches across formats — the whole reason imports link at all', () => {
    // Exact string matching linked 6 of 51 real calls; last-10 linked 35.
    const k = phoneKey('+16315550029')
    expect(phoneKey('(631) 555-0029')).toBe(k)
    expect(phoneKey('631.555.0029')).toBe(k)
    expect(phoneKey('1-631-555-0029')).toBe(k)
  })

  it('refuses a number too short to identify anyone', () => {
    // A 6-digit key would collide across unrelated contacts and attach a call
    // to the wrong lead — worse than leaving it unlinked.
    expect(phoneKey('555-0029')).toBeNull()
    expect(phoneKey('')).toBeNull()
    expect(phoneKey(null)).toBeNull()
  })
})

describe('callStartMs', () => {
  it('reconstructs the start from hangup minus duration', () => {
    expect(new Date(callStartMs(answered)).toISOString()).toBe('2026-09-11T14:12:34.000Z')
  })

  it('works on unanswered calls, which have no answer time at all', () => {
    // This is the field that disappears — 0 of 6 non-Completed records had it.
    expect(callStartMs(noAnswer)).toBeTruthy()
    expect(new Date(callStartMs(noAnswer)).toISOString()).toBe('2026-09-07T14:45:15.000Z')
  })

  it('returns null rather than an Invalid Date when both timestamps are gone', () => {
    expect(callStartMs({ callStatus: 'Completed' })).toBeNull()
  })
})

describe('isAnswered — the pickup signal', () => {
  it('is true for Completed, false for every other status seen', () => {
    expect(isAnswered(answered)).toBe(true)
    for (const s of ['No Answer', 'Rejected', 'Missed']) {
      expect(isAnswered({ ...noAnswer, callStatus: s }), s).toBe(false)
    }
  })

  it('falls back to callAnswerTime if they add a status we do not know', () => {
    // A new status must not silently read as "never picked up".
    expect(isAnswered({ callStatus: 'SomethingNew', callAnswerTime: answered.callAnswerTime })).toBe(true)
  })
})

describe('mapCall', () => {
  it('links a call to its lead by phone', () => {
    const row = mapCall(answered, leads)
    expect(row.lead_id).toBe(42)
    expect(row.lead_name).toBe('Ana Reyes')
  })

  it('imports an unmatched call rather than dropping it', () => {
    const row = mapCall({ ...answered, to: '+19995550000' }, leads)
    expect(row.lead_id).toBeNull()
    expect(row.phone_number).toBe('+19995550000')
  })

  it('NEVER invents an outcome — CallHippo cannot know one', () => {
    // The line connecting is not the same as reaching the decision maker.
    // Guessing here would inflate the conversation rate permanently.
    expect(mapCall(answered, leads).call_outcome).toBeNull()
    expect(mapCall(noAnswer, leads).call_outcome).toBeNull()
  })

  it('leaves the call unclaimed — one shared seat means no known owner', () => {
    expect(mapCall(answered, leads).logged_by).toBeNull()
  })

  it("uses a neutral status, not the null-outcome derivation", () => {
    // statusForOutcome(null) is 'no_response'; using it here would drag every
    // reply rate in the app down with calls nobody has judged yet.
    expect(mapCall(answered, leads).status).toBe('sent')
  })

  it('carries the dedupe key and the raw record', () => {
    const row = mapCall(answered, leads)
    expect(row.provider_call_id).toBe(answered.callSid)
    // The API refuses logs older than a month, so our copy is the only copy.
    expect(row.provider_payload).toEqual(answered)
  })

  it('records connection and talk time from the carrier', () => {
    expect(mapCall(answered, leads).connected).toBe(true)
    expect(mapCall(answered, leads).call_duration_seconds).toBe(86)
    expect(mapCall(noAnswer, leads).connected).toBe(false)
  })

  it('clamps an absurd duration instead of poisoning average talk time', () => {
    expect(mapCall({ ...answered, totalCallDuration: 999999 }, leads).call_duration_seconds).toBe(86400)
    expect(mapCall({ ...answered, totalCallDuration: -5 }, leads).call_duration_seconds).toBe(0)
  })

  it('buckets the call on its IST calendar day', () => {
    // 14:12 UTC is 19:42 IST — same day here, but the offset is what the
    // daily target, the streak and the digest all count on.
    expect(mapCall(answered, leads).outreach_date).toBe('2026-09-11')
    // 20:00 UTC is 01:30 IST the NEXT day.
    const late = { ...answered, callHangupTime: 'Fri Sep 11 2026 20:00:00 GMT+0000', totalCallDuration: 0 }
    expect(mapCall(late, leads).outreach_date).toBe('2026-09-12')
  })

  it('keeps an empty recording URL as null, not an empty string', () => {
    // All 53 sampled records had recordingUrl: '' — recording is off or not
    // on the plan. An empty string would render as a broken link.
    expect(mapCall(answered, leads).recording_url).toBeNull()
  })
})
