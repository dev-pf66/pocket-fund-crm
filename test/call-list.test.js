// Guardrails for parsing a pasted cold-call list.
//
// A call list is not self-identifying the way a LinkedIn URL is: it arrives as
// "name, number", "name, firm, number", or a bare column of numbers, in
// whatever order the source felt like. The phone is therefore found by SHAPE,
// and the two rules that matter are both about not inventing data —
// an unresolvable number is kept verbatim and flagged rather than guessed at,
// and a nameless row is filed under its own number rather than "Unknown",
// which would collapse a 300-row batch onto one indistinguishable name.

import { describe, it, expect, vi } from 'vitest'
import { parseCallListText, phoneKey } from '../src/lib/callList.js'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))

vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

// fetchAllRows pages until a short page comes back, so the existing-leads
// responder must serve its rows once and then empty.
async function freshDb(existingLeads) {
  let served = false
  h.db = fakeSupabase((op) => {
    if (op.table === 'crm_leads' && op.type === 'select') {
      if (served) return { data: [] }
      served = true
      return { data: existingLeads }
    }
    if (op.table === 'crm_leads' && op.type === 'insert') return { data: op.payload }
    return { data: [] }
  })
  const mod = await import('../src/lib/api/calls.js')
  return { db: h.db, bulkCreateCallLeads: mod.bulkCreateCallLeads }
}

describe('finds the phone by shape, not position', () => {
  it('reads a bare column of numbers', () => {
    const { rows } = parseCallListText('+14155550142\n+14155550143')
    expect(rows).toHaveLength(2)
    expect(rows[0].phone).toBe('+14155550142')
  })

  it('reads "name, number"', () => {
    const { rows } = parseCallListText('John Smith, +14155550142')
    expect(rows[0]).toMatchObject({ name: 'John Smith', firm_name: '', phone: '+14155550142' })
  })

  it('reads "name, firm, number" and "number, name" alike', () => {
    const a = parseCallListText('Jane Doe, Acme Capital, +14155550142').rows[0]
    expect(a).toMatchObject({ name: 'Jane Doe', firm_name: 'Acme Capital' })

    // Source put the number first — position must not decide.
    const b = parseCallListText('+14155550142, Jane Doe, Acme Capital').rows[0]
    expect(b).toMatchObject({ name: 'Jane Doe', firm_name: 'Acme Capital', phone: '+14155550142' })
  })

  it('handles tab and semicolon separated exports', () => {
    expect(parseCallListText('John Smith\t+14155550142').rows[0].name).toBe('John Smith')
    expect(parseCallListText('John Smith;+14155550142').rows[0].name).toBe('John Smith')
  })

  it('does not mistake a firm name containing digits for the number', () => {
    const r = parseCallListText('Amari Ruff, 6.8.10 Capital Partners, +14155550142').rows[0]
    expect(r.phone).toBe('+14155550142')
    expect(r.firm_name).toBe('6.8.10 Capital Partners')
  })
})

describe('never invents', () => {
  it('keeps an unresolvable number verbatim and flags it', () => {
    // No default dial code, so a local number cannot be resolved — and must
    // not have one guessed onto it.
    const { rows, unresolved } = parseCallListText('John Smith, 4155550142', null)
    expect(unresolved).toBe(1)
    expect(rows[0].resolved).toBe(false)
    expect(rows[0].phone).toBe('4155550142')
  })

  it('applies a default dial code only when told to', () => {
    const { rows, unresolved } = parseCallListText('John Smith, 4155550142', '1')
    expect(unresolved).toBe(0)
    expect(rows[0].phone).toBe('+14155550142')
  })

  it('files a nameless row under its own number, not "Unknown"', () => {
    const { rows } = parseCallListText('+14155550142\n+14155550143')
    expect(rows.map(r => r.name)).toEqual(['+14155550142', '+14155550143'])
    // The failure this prevents: a whole batch sharing one name.
    expect(new Set(rows.map(r => r.name)).size).toBe(rows.length)
  })
})

describe('rejects rather than imports junk', () => {
  it('reports a line with no phone instead of creating a lead', () => {
    const { rows, invalid } = parseCallListText('John Smith, Acme Capital')
    expect(rows).toHaveLength(0)
    expect(invalid[0].reason).toBe('no phone number found')
  })

  it('treats too-few digits as not a phone', () => {
    const { rows, invalid } = parseCallListText('Bob, 12345')
    expect(rows).toHaveLength(0)
    expect(invalid).toHaveLength(1)
  })

  it('skips blank lines silently', () => {
    const { rows, invalid } = parseCallListText('\n  \n+14155550142\n\n')
    expect(rows).toHaveLength(1)
    expect(invalid).toHaveLength(0)
  })
})

describe('phoneKey', () => {
  it('matches the same line across formats', () => {
    const k = phoneKey('+1 (415) 555-0142')
    for (const v of ['4155550142', '+14155550142', '415.555.0142', '(415) 555 0142']) {
      expect(phoneKey(v)).toBe(k)
    }
  })

  it('is empty for a value with no digits', () => {
    expect(phoneKey('')).toBe('')
    expect(phoneKey('n/a')).toBe('')
  })
})

// ---------------------------------------------------------------------------

describe('bulkCreateCallLeads', () => {
  it('dedupes on the number, not the formatting', async () => {
    const { db, bulkCreateCallLeads } = await freshDb([{ phone: '+1 (415) 555-0142' }])
    const res = await bulkCreateCallLeads(
      [{ name: 'Dup', phone: '4155550142' }, { name: 'New', phone: '+14155550199' }],
      'Sept list', 7
    )
    expect(res.added).toBe(1)
    expect(res.skipped).toBe(1)
    const inserted = db.opsFor('crm_leads', 'insert')[0].payload
    expect(inserted.map(r => r.name)).toEqual(['New'])
  })

  it('dedupes within the paste itself', async () => {
    const { bulkCreateCallLeads } = await freshDb([])
    const res = await bulkCreateCallLeads(
      [{ name: 'A', phone: '+14155550142' }, { name: 'A again', phone: '415 555 0142' }],
      null, 7
    )
    expect(res.added).toBe(1)
  })

  it('sets the fields the call queue filters on', async () => {
    const { db, bulkCreateCallLeads } = await freshDb([])
    await bulkCreateCallLeads([{ name: 'A', phone: '+14155550142' }], 'Sept', 7)
    const row = db.opsFor('crm_leads', 'insert')[0].payload[0]
    // getCallQueue requires a non-empty phone, do_not_call false, and a stage
    // outside client/passed. Miss any one and the import is invisible.
    expect(row.phone).toBe('+14155550142')
    expect(row.do_not_call).toBe(false)
    expect(row.stage).toBe('outreach')
    expect(row.assigned_to).toBe(7)
  })

  it('round-robins across the chosen assignees', async () => {
    const { db, bulkCreateCallLeads } = await freshDb([])
    await bulkCreateCallLeads(
      [1, 2, 3, 4].map(n => ({ name: `L${n}`, phone: `+1415555010${n}` })),
      'Sept', 7, [11, 22]
    )
    expect(db.opsFor('crm_leads', 'insert')[0].payload.map(r => r.assigned_to))
      .toEqual([11, 22, 11, 22])
  })

  it('groups the import under one batch id', async () => {
    const { db, bulkCreateCallLeads } = await freshDb([])
    await bulkCreateCallLeads(
      [1, 2].map(n => ({ name: `L${n}`, phone: `+1415555010${n}` })), 'Sept list', 7
    )
    const rows = db.opsFor('crm_leads', 'insert')[0].payload
    expect(new Set(rows.map(r => r.import_batch_id)).size).toBe(1)
    expect(rows[0].import_batch_label).toBe('Sept list')
  })

  it('writes nothing when every number is already on file', async () => {
    const { db, bulkCreateCallLeads } = await freshDb([{ phone: '+14155550142' }])
    const res = await bulkCreateCallLeads([{ name: 'Dup', phone: '4155550142' }], null, 7)
    expect(res.added).toBe(0)
    expect(db.opsFor('crm_leads', 'insert')).toHaveLength(0)
  })

  it('writes nothing for entries with no usable number', async () => {
    const { db, bulkCreateCallLeads } = await freshDb([])
    const res = await bulkCreateCallLeads([{ name: 'No phone', phone: '' }], null, 7)
    expect(res.added).toBe(0)
    expect(db.ops).toHaveLength(0)
  })
})

describe('getCallQueue feeds the Queue tab', () => {
  it('selects the batch columns the grouping depends on', async () => {
    // Without these the Queue tab still renders — every imported list just
    // silently collapses into one ungrouped pile. Nothing errors, so only a
    // test catches it.
    h.db = fakeSupabase(() => ({ data: [] }))
    const { getCallQueue } = await import('../src/lib/api/calls.js')
    await getCallQueue(7, { limit: 10 })
    const cols = h.db.opsFor('crm_leads', 'select')[0].selectArgs || ''
    expect(cols).toContain('import_batch_id')
    expect(cols).toContain('import_batch_label')
    // The columns the queue filter itself depends on, while we are here.
    expect(cols).toContain('phone')
    expect(cols).toContain('do_not_call')
  })
})
