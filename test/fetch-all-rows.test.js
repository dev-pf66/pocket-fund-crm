// Guardrail for the pagination helper.
//
// This repo has fixed the "PostgREST silently truncates at 1000 rows" bug in
// at least three separate places. fetchAllRows is now the single answer, so
// its edge cases — the exact-multiple boundary especially — are worth pinning.

import { describe, it, expect } from 'vitest'
import { fetchAllRows } from '../src/lib/api/core.js'

// A factory that serves `total` rows out of a fake table, one .range() at a
// time, and counts how many times it was called.
function pagedSource(total) {
  const state = { builds: 0 }
  const factory = () => {
    state.builds += 1
    return {
      range: async (from, to) => ({
        data: Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) },
          (_, i) => ({ id: from + i })),
        error: null
      })
    }
  }
  return { factory, state }
}

describe('fetchAllRows', () => {
  it('returns every row across multiple pages', async () => {
    const { factory } = pagedSource(2500)
    const rows = await fetchAllRows(factory, { pageSize: 1000 })
    expect(rows).toHaveLength(2500)
    expect(rows[0].id).toBe(0)
    expect(rows[2499].id).toBe(2499)
  })

  it('terminates when the total is an exact multiple of the page size', async () => {
    // The boundary that naive paging loops get wrong: page 2 comes back full,
    // so the loop must ask for page 3 and only stop on the empty page.
    const { factory, state } = pagedSource(2000)
    const rows = await fetchAllRows(factory, { pageSize: 1000 })
    expect(rows).toHaveLength(2000)
    expect(state.builds).toBe(3)
  })

  it('builds a fresh query per page — a supabase builder is single-use', async () => {
    const { factory, state } = pagedSource(2500)
    await fetchAllRows(factory, { pageSize: 1000 })
    expect(state.builds).toBe(3)
  })

  it('stops at maxRows without over-fetching', async () => {
    const { factory, state } = pagedSource(10_000)
    const rows = await fetchAllRows(factory, { pageSize: 1000, maxRows: 2500 })
    expect(rows).toHaveLength(2500)
    expect(state.builds).toBe(3)
    // The last page must be a partial request, not a full page thrown away.
    expect(rows[2499].id).toBe(2499)
  })

  it('handles an empty table', async () => {
    const { factory } = pagedSource(0)
    expect(await fetchAllRows(factory)).toEqual([])
  })

  it('propagates a query error instead of returning a short page', async () => {
    const factory = () => ({
      range: async () => ({ data: null, error: new Error('boom') })
    })
    await expect(fetchAllRows(factory)).rejects.toThrow('boom')
  })
})
