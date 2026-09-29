// Guardrails for tags-as-lists.
//
// `crm_tags` and `crm_lead_tags` have existed since migration 003. The app could
// read tags, assign one to a lead and unassign it — but there was NO create path
// anywhere and nothing could filter by a tag. So the vocabulary was frozen at the
// 8 rows migration 003 happened to seed, which is why "Met at Conference" exists
// as a generic label and no actual conference name ever could, and why a tag
// could not become a list. 8 lead-tag links existed across 596 leads.
//
// Dev, Sept 2026: "more tags like the conference I met them at or if they came
// through linkedin, so we can create lists."
//
// The rules that make this survive:
//
//  1. NAMES MATCH CASE-INSENSITIVELY. crm_tags.name is UNIQUE, so "SaaS Connect"
//     and "saas connect" would be two tags that look like one — the same casing
//     bug that duplicated people rows and cost an afternoon.
//  2. AN EXISTING NAME RETURNS THE EXISTING TAG rather than throwing. The caller
//     wanted a tag with this name; there is one.
//  3. BULK TAGGING IS IDEMPOTENT. (lead_id, tag_id) is the primary key, so
//     re-tagging a lead already in the list must be a no-op, not a 23505.
//  4. THE JOIN READ IS PAGED. It grows with every tag applied, and a truncated
//     page silently drops tags off the end of the board — which would look like
//     the filter losing leads.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from './helpers/fake-supabase.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../src/lib/supabase', () => ({
  get supabase() { return h.db },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon'
}))

const { createTag, renameTag, addTagToLeads, getTagsByLead, getTagUsage } =
  await import('../src/lib/api/misc.js')

const EXISTING = [
  { id: 1, name: 'Met at Conference', color: '#10b981' },
  { id: 2, name: 'Warm Intro', color: '#f59e0b' },
]

/** Serves `tags` for reads on crm_tags, `links` for crm_lead_tags. */
function serving({ tags = EXISTING, links = [] } = {}) {
  return (op) => {
    if (op.table === 'crm_tags' && op.type === 'insert') {
      return { data: { id: 99, ...(Array.isArray(op.payload) ? op.payload[0] : op.payload) } }
    }
    if (op.table === 'crm_tags' && op.type === 'update') {
      return { data: { id: 1, ...op.payload } }
    }
    if (op.table === 'crm_tags') return { data: tags }
    if (op.table === 'crm_lead_tags' && op.type === 'upsert') {
      return { data: (op.payload || []).map(r => ({ lead_id: r.lead_id })) }
    }
    if (op.table === 'crm_lead_tags') return { data: links }
    return { data: [] }
  }
}

beforeEach(() => { vi.restoreAllMocks(); h.db = fakeSupabase(serving()) })

describe('createTag', () => {
  it('creates a tag with a trimmed name and an auto colour', async () => {
    const t = await createTag('  SaaS Connect 2026  ')

    const ins = h.db.opsFor('crm_tags', 'insert')[0].payload[0]
    expect(ins.name).toBe('SaaS Connect 2026')
    expect(ins.color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(t.id).toBe(99)
  })

  it('reuses an existing tag rather than erroring on the unique name', async () => {
    const t = await createTag('Warm Intro')

    expect(t.id).toBe(2)
    expect(h.db.opsFor('crm_tags', 'insert')).toHaveLength(0)
  })

  it('matches case-insensitively, so casing cannot mint a twin', async () => {
    // crm_tags.name is UNIQUE — "warm intro" would otherwise be a second tag
    // that renders identically to the first.
    for (const variant of ['warm intro', 'WARM INTRO', '  Warm Intro ']) {
      h.db = fakeSupabase(serving())
      const t = await createTag(variant)
      expect(t.id).toBe(2)
      expect(h.db.opsFor('crm_tags', 'insert')).toHaveLength(0)
    }
  })

  it('refuses an empty or whitespace name, and writes nothing', async () => {
    for (const bad of ['', '   ', null, undefined]) {
      h.db = fakeSupabase(serving())
      await expect(createTag(bad)).rejects.toThrow(/needs a name/)
      expect(h.db.opsFor('crm_tags', 'insert')).toHaveLength(0)
    }
  })

  it('refuses a name longer than the column allows', async () => {
    await expect(createTag('x'.repeat(101))).rejects.toThrow(/too long/)
    expect(h.db.opsFor('crm_tags', 'insert')).toHaveLength(0)
  })
})

describe('renameTag', () => {
  it('renames in place, so every lead carrying it follows', async () => {
    // The links point at the id, which is why a typo is fixable without
    // re-tagging anyone.
    await renameTag(1, '  SaaS Connect 2026 ')
    expect(h.db.opsFor('crm_tags', 'update')[0].payload).toEqual({ name: 'SaaS Connect 2026' })
  })

  it('refuses to blank a name', async () => {
    await expect(renameTag(1, '  ')).rejects.toThrow(/needs a name/)
    expect(h.db.opsFor('crm_tags', 'update')).toHaveLength(0)
  })
})

describe('addTagToLeads', () => {
  it('applies one tag to many leads', async () => {
    const n = await addTagToLeads([1, 2, 3], 7)

    expect(n).toBe(3)
    const rows = h.db.opsFor('crm_lead_tags', 'upsert')[0].payload
    expect(rows).toEqual([
      { lead_id: 1, tag_id: 7 }, { lead_id: 2, tag_id: 7 }, { lead_id: 3, tag_id: 7 }
    ])
  })

  it('is idempotent — re-tagging a lead already in the list is not an error', async () => {
    await addTagToLeads([1], 7)
    const op = h.db.opsFor('crm_lead_tags', 'upsert')[0]
    // (lead_id, tag_id) is the PK; a plain insert would raise 23505.
    expect(op.calls).toContain('upsert')
  })

  it('de-duplicates the ids it was handed', async () => {
    await addTagToLeads([5, 5, 5], 7)
    expect(h.db.opsFor('crm_lead_tags', 'upsert')[0].payload).toEqual([{ lead_id: 5, tag_id: 7 }])
  })

  it('chunks a large list so the request cannot blow up', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => i + 1)
    await addTagToLeads(ids, 7)
    expect(h.db.opsFor('crm_lead_tags', 'upsert')).toHaveLength(3) // 200+200+50
  })

  it('writes nothing when given no leads or no tag', async () => {
    expect(await addTagToLeads([], 7)).toBe(0)
    expect(await addTagToLeads([1], null)).toBe(0)
    expect(h.db.opsFor('crm_lead_tags', 'upsert')).toHaveLength(0)
  })
})

describe('reading tags for the board', () => {
  it('groups links into leadId -> tags', async () => {
    h.db = fakeSupabase(serving({ links: [
      { lead_id: 10, tag: { id: 1, name: 'A', color: '#111111' } },
      { lead_id: 10, tag: { id: 2, name: 'B', color: '#222222' } },
      { lead_id: 11, tag: { id: 1, name: 'A', color: '#111111' } },
    ] }))
    const byLead = await getTagsByLead()

    expect(byLead.get(10).map(t => t.name)).toEqual(['A', 'B'])
    expect(byLead.get(11).map(t => t.name)).toEqual(['A'])
    expect(byLead.has(12)).toBe(false)
  })

  it('skips a link whose tag was deleted rather than crashing the board', async () => {
    h.db = fakeSupabase(serving({ links: [
      { lead_id: 10, tag: null },
      { lead_id: 10, tag: { id: 1, name: 'A', color: '#111111' } },
    ] }))
    expect((await getTagsByLead()).get(10).map(t => t.name)).toEqual(['A'])
  })

  it('pages the join read and sorts it totally', async () => {
    h.db = fakeSupabase(serving({ links: [] }))
    await getTagsByLead()
    const op = h.db.opsFor('crm_lead_tags', 'select')[0]
    // fetchAllRows pages via .range; an ordered total sort keeps page boundaries
    // from skipping or duplicating rows.
    expect(op.calls).toContain('range')
    expect(op.calls).toContain('order')
  })

  it('counts usage per tag, so a rename or removal is informed', async () => {
    h.db = fakeSupabase(serving({ links: [
      { tag_id: 1 }, { tag_id: 1 }, { tag_id: 2 },
    ] }))
    const counts = await getTagUsage()
    expect(counts.get(1)).toBe(2)
    expect(counts.get(2)).toBe(1)
  })
})
