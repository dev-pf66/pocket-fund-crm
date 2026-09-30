import { describe, it, expect } from 'vitest'
import { OUTREACH_STATUSES, REPLY_STATUSES, AWAITING_STATUSES, isReply, normalizeOutreachStatus } from '../src/lib/outreachStatus'

describe('outreach status vocabulary', () => {
  it('offers the seven statuses', () => {
    expect(OUTREACH_STATUSES.map(s => s.value).sort()).toEqual(
      ['bounced', 'follow_up_1', 'follow_up_2', 'no_response', 'rejected', 'replied', 'sent'])
  })

  it('counts a rejection as a reply — they responded', () => {
    expect(isReply('rejected')).toBe(true)
    expect(isReply('replied')).toBe(true)
    for (const s of ['sent', 'follow_up_1', 'follow_up_2', 'no_response', 'bounced']) expect(isReply(s)).toBe(false)
  })

  it('reply and awaiting sets never overlap', () => {
    expect(REPLY_STATUSES.filter(s => AWAITING_STATUSES.includes(s))).toEqual([])
  })

  it('normalises free-text CSV values', () => {
    expect(normalizeOutreachStatus('Rejected')).toBe('rejected')
    expect(normalizeOutreachStatus('FU 1')).toBe('follow_up_1')
    expect(normalizeOutreachStatus('Follow up 2')).toBe('follow_up_2')
    expect(normalizeOutreachStatus('In Conversation')).toBe('replied')
    expect(normalizeOutreachStatus('Reached Out')).toBe('sent')
    expect(normalizeOutreachStatus('no response')).toBe('no_response')
  })
})
