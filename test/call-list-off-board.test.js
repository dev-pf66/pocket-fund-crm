// Guardrail: uncalled cold-call list leads stay off the Pipeline board
// (Dev, 2026-11-17: "remove the cold call queue leads that go in the pipeline").
//
// A pasted call list creates every number at stage `outreach`; one sheet put
// ~100 never-spoken-to names in the board's Outreach column. They are hidden
// from the BOARD only — never archived, never deleted — and a call that moves
// one forward must put it back on the board. The second half of that is the
// part a careless "fix" would break.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isUnworkedCallListLead, CALL_LIST_SOURCE } from '../src/lib/callList.js'

describe('isUnworkedCallListLead', () => {
  it('hides a call-list lead still at outreach', () => {
    expect(isUnworkedCallListLead({ lead_source: CALL_LIST_SOURCE, stage: 'outreach' })).toBe(true)
  })

  it('shows a call-list lead once a call has moved it forward', () => {
    for (const stage of ['responded', 'meeting_booked', 'warm_active', 'client']) {
      expect(isUnworkedCallListLead({ lead_source: CALL_LIST_SOURCE, stage })).toBe(false)
    }
  })

  it('never hides an outreach lead from any other source', () => {
    for (const lead_source of ['Bulk Import', 'LinkedIn', '', null, undefined]) {
      expect(isUnworkedCallListLead({ lead_source, stage: 'outreach' })).toBe(false)
    }
    // A phone number alone is not the marker — 33 hand-entered outreach leads
    // carry one and were never on a call list.
    expect(isUnworkedCallListLead({ phone: '+919999999999', stage: 'outreach' })).toBe(false)
  })

  it('the importer stamps the same source the board filters on', () => {
    const src = readFileSync(new URL('../src/lib/api/calls.js', import.meta.url), 'utf8')
    expect(src).toMatch(/lead_source:\s*CALL_LIST_SOURCE/)
  })

  it('the Pipeline board builds its columns from the filtered list', () => {
    const src = readFileSync(new URL('../src/pages/LeadsBoard.jsx', import.meta.url), 'utf8')
    expect(src).toMatch(/leads\.filter\(l => !isUnworkedCallListLead\(l\)\)/)
    expect(src).toMatch(/for \(const lead of boardLeads\)/)
  })
})
