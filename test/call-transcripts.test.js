// Guardrails for attaching a transcript to a cold call.
//
// The rule that is easy to lose: a transcript belongs to a DIAL, not just to
// a lead. Cold calling puts up to MAX_CALL_ATTEMPTS dials against the same
// contact, so a transcript carrying only lead_id cannot say which
// conversation it records — the eighth attempt and the first look identical.
//
// The other rule is silence-shaped: an empty paste must not create a row.
// crm_transcripts.transcript is NOT NULL, and a whitespace-only insert would
// either fail loudly mid-call or file an empty record that looks like
// evidence a conversation was captured when none was.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))

vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { logCallTranscript, getCallTranscriptIds } = await import('../src/lib/api/calls.js')

const accept = (op) => {
  if (op.table === 'crm_transcripts' && op.type === 'insert') return { data: { id: 1, ...op.payload[0] } }
  return { data: [] }
}

beforeEach(() => {
  vi.restoreAllMocks()
  h.db = fakeSupabase(accept)
})

describe('logCallTranscript', () => {
  it('links the transcript to the dial as well as the lead', async () => {
    await logCallTranscript({
      leadId: 281,
      outreachLogId: 9001,
      transcript: 'Them: hello. Us: hi.',
      calledAt: '2026-09-04T10:00:00.000Z',
      currentPersonId: 7
    })

    const [op] = h.db.opsFor('crm_transcripts', 'insert')
    expect(op.payload[0]).toMatchObject({
      lead_id: 281,
      outreach_log_id: 9001,
      transcript: 'Them: hello. Us: hi.',
      call_date: '2026-09-04T10:00:00.000Z',
      created_by: 7
    })
  })

  it('trims the pasted text', async () => {
    await logCallTranscript({ leadId: 1, outreachLogId: 2, transcript: '  real content  ' })
    expect(h.db.opsFor('crm_transcripts', 'insert')[0].payload[0].transcript).toBe('real content')
  })

  it('writes nothing for an empty or whitespace-only paste', async () => {
    for (const empty of ['', '   ', '\n\t ', null, undefined]) {
      h.db = fakeSupabase(accept)
      expect(await logCallTranscript({ leadId: 1, outreachLogId: 2, transcript: empty })).toBeNull()
      expect(h.db.ops).toHaveLength(0)
    }
  })

  it('writes nothing without a lead to hang it on', async () => {
    expect(await logCallTranscript({ leadId: null, outreachLogId: 2, transcript: 'words' })).toBeNull()
    expect(h.db.ops).toHaveLength(0)
  })

  it('still records a transcript that has no dial to link to', async () => {
    // Nullable by design (migration 047) — a transcript with no call row is
    // worth less than one with, but far more than none.
    await logCallTranscript({ leadId: 281, transcript: 'words' })
    expect(h.db.opsFor('crm_transcripts', 'insert')[0].payload[0].outreach_log_id).toBeNull()
  })

  it('throws so the caller can report it — the dial is already logged by then', async () => {
    h.db = fakeSupabase(() => ({ data: null, error: { message: 'insert failed' } }))
    await expect(logCallTranscript({ leadId: 1, outreachLogId: 2, transcript: 'words' }))
      .rejects.toThrow()
  })
})

describe('getCallTranscriptIds', () => {
  it('returns the dials that already have a transcript', async () => {
    h.db = fakeSupabase((op) => {
      if (op.table === 'crm_transcripts') return { data: [{ outreach_log_id: 11 }, { outreach_log_id: 13 }] }
      return { data: [] }
    })
    const ids = await getCallTranscriptIds([11, 12, 13])
    expect(ids).toBeInstanceOf(Set)
    expect([...ids].sort()).toEqual([11, 13])
    expect(ids.has(12)).toBe(false)
  })

  it('does not query at all for an empty or all-null list', async () => {
    expect((await getCallTranscriptIds([])).size).toBe(0)
    expect((await getCallTranscriptIds([null, undefined])).size).toBe(0)
    expect(h.db.ops).toHaveLength(0)
  })
})
