// Guardrail: every task the CRM files at Sage must name a project.
//
// Sage rejects a create without one — 400 "deal_id or internal_project_id is
// required" — and nothing in this repo ever sent one. From mid-August 2026
// every lead_reply, lead_followup, lead_kickoff, manual_task and weekly digest
// task 400'd on the way out.
//
// It ran for three weeks unnoticed because the alarm shares the failure mode:
// alertFailure() reports a broken digest BY FILING A TASK, so the thing built
// to make this visible died of the same cause. That is why the default is
// injected in tt.createTask itself rather than at each call site — a caller
// cannot forget what it never has to remember.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({}) })
}))

process.env.TASK_TRACKER_API_URL = 'http://tracker.test'
process.env.TASK_TRACKER_API_KEY = 'test-key'

const { tt } = await import('../src/lib/integrations/task-tracker.js')

beforeEach(() => {
  h.calls = []
  global.fetch = vi.fn(async (url, opts) => {
    h.calls.push({ url, body: JSON.parse(opts.body) })
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 999 }) }
  })
})

const lastBody = () => h.calls.at(-1).body

describe('tt.createTask always names a project', () => {
  it('injects the PF sales project when the caller names none', async () => {
    await tt.createTask({ title: 'Reply to Acme', assigned_to: 2, due_date: '2026-09-07' })
    // The exact id the digest and the lead rules depend on.
    expect(lastBody().internal_project_id).toBe('22f6f543-68bc-4dbf-be5b-27432ac649ba')
  })

  it('never sends a create with neither project field', async () => {
    for (const payload of [{}, { title: 'x' }, { title: 'x', assigned_to: null }]) {
      await tt.createTask(payload)
      const b = lastBody()
      expect(b.deal_id != null || b.internal_project_id != null).toBe(true)
    }
  })

  it('tags provenance so these are findable in the tracker later', async () => {
    await tt.createTask({ title: 'x' })
    expect(lastBody().source).toBe('crm')
  })
})

describe('a caller that picked its own project keeps it', () => {
  it('does not override an explicit internal_project_id', async () => {
    await tt.createTask({ title: 'x', internal_project_id: 'abc-123' })
    expect(lastBody().internal_project_id).toBe('abc-123')
  })

  it('does not bolt its default onto a deal_id create', async () => {
    // deal_id satisfies the API on its own; sending both is muddled.
    await tt.createTask({ title: 'x', deal_id: 14 })
    expect(lastBody().deal_id).toBe(14)
    expect(lastBody().internal_project_id).toBeUndefined()
  })

  it('lets a caller override source', async () => {
    await tt.createTask({ title: 'x', source: 'meeting_agent' })
    expect(lastBody().source).toBe('meeting_agent')
  })
})

describe('the payload is otherwise untouched', () => {
  it('passes the caller fields through unchanged', async () => {
    await tt.createTask({
      title: 'Kickoff: Acme', description: 'body', priority: 'high',
      status: 'not_started', due_date: '2026-09-07', assigned_to: 2, created_by: 2
    })
    expect(lastBody()).toMatchObject({
      title: 'Kickoff: Acme', description: 'body', priority: 'high',
      status: 'not_started', due_date: '2026-09-07', assigned_to: 2, created_by: 2
    })
    expect(h.calls.at(-1).url).toBe('http://tracker.test/tasks')
  })
})
