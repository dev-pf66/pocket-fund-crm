// Guardrail: /api/enrich-linkedin must never invent a person.
//
// This endpoint has no access to LinkedIn. It used to ask a model to
// "generate realistic and plausible professional enrichment data" from the
// profile URL slug and write the answer to linkedin_headline,
// current_position, past_experience and education as fact. All three leads it
// ever ran on had a blank firm_name, so it invented an employer for each —
// Venn Capital, Stride Capital, Milestone Capital Partners — plus degrees from
// ESCP, IIM Ahmedabad and ISB, then stamped the row `enriched`. Anyone opening
// one of those leads before a call reads fiction presented as research.
//
// The rules pinned here: those four columns are never written; the prompt is
// grounded in CRM facts only; a lead with nothing on file gets an honest
// "no context" instead of a model call.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  ops: [],
  prompts: [],
  lead: null,
  reply: {}
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        single: () => Promise.resolve({ data: h.lead, error: h.lead ? null : { message: 'not found' } }),
        update(payload) { h.ops.push({ table, type: 'update', payload }); return chain },
        insert(payload) { h.ops.push({ table, type: 'insert', payload }); return Promise.resolve({ data: payload, error: null }) },
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve) }
      }
      return chain
    }
  })
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = {
        create: async ({ messages }) => {
          h.prompts.push(messages[0].content)
          return { content: [{ text: JSON.stringify(h.reply) }] }
        }
      }
    }
  }
}))

vi.mock('../api/_auth.js', () => ({ isAuthorized: async () => true }))

process.env.ANTHROPIC_API_KEY = 'test'
process.env.VITE_SUPABASE_URL = 'http://localhost'
process.env.VITE_SUPABASE_ANON_KEY = 'anon'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'

const { default: handler } = await import('../api/enrich-linkedin.js')

const INVENTED_COLUMNS = ['linkedin_headline', 'current_position', 'past_experience', 'education']

function res() {
  const r = { statusCode: null, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.end = () => r
  return r
}

const call = async (body) => {
  const r = res()
  await handler({ method: 'POST', headers: {}, body }, r)
  return r
}

const leadWrites = () => h.ops.filter(o => o.table === 'crm_leads' && o.type === 'update')

beforeEach(() => {
  h.ops = []
  h.prompts = []
  h.lead = null
  // What the old prompt asked for, and what a future edit might reintroduce.
  h.reply = {
    summary: 'Runs a lower-mid-market fund; approach via the deal criteria on file.',
    suggested_lead_type: 'PE Firm',
    linkedin_headline: 'Managing Partner at Venn Capital',
    current_position: 'Investment Manager, Venn Capital',
    past_experience: 'Analyst, Somewhere',
    education: 'MBA, ESCP'
  }
})

describe('never writes invented biography columns', () => {
  it('drops them even when the model volunteers them', async () => {
    h.lead = { id: 597, name: 'Amine Boukioud', firm_name: 'Real Firm Ltd', lead_type: 'PE Firm', notes: '', deal_criteria: '' }
    const r = await call({ leadId: 597, linkedinUrl: 'https://www.linkedin.com/in/amine-boukioud/' })

    expect(r.statusCode).toBe(200)
    for (const write of leadWrites()) {
      for (const col of INVENTED_COLUMNS) {
        expect(write.payload, `wrote ${col}`).not.toHaveProperty(col)
      }
    }
    for (const col of INVENTED_COLUMNS) {
      expect(r.body.enrichment).not.toHaveProperty(col)
    }
  })

  it('records the write as a summary, not as enrichment', async () => {
    h.lead = { id: 597, name: 'Amine', firm_name: 'Real Firm Ltd', lead_type: '', notes: '', deal_criteria: '' }
    await call({ leadId: 597, linkedinUrl: 'https://www.linkedin.com/in/amine-boukioud/' })
    const final = leadWrites().at(-1)
    expect(final.payload.enrichment_status).toBe('summarized')
    // 'enriched' is now reserved for the fabricated legacy rows migration 046
    // relabels; nothing may write it again.
    expect(leadWrites().some(w => w.payload.enrichment_status === 'enriched')).toBe(false)
  })

  it('flags the logged activity as CRM-context-only', async () => {
    h.lead = { id: 597, name: 'Amine', firm_name: 'Real Firm Ltd', lead_type: '', notes: '', deal_criteria: '' }
    await call({ leadId: 597, linkedinUrl: 'https://www.linkedin.com/in/amine-boukioud/' })
    const activity = h.ops.find(o => o.table === 'crm_lead_activities')
    expect(activity.payload[0].notes).toContain('no LinkedIn data was fetched')
  })
})

describe('the prompt is grounded', () => {
  it('forbids invention and never asks for plausible detail', async () => {
    h.lead = { id: 1, name: 'X', firm_name: 'Real Firm Ltd', lead_type: '', notes: '', deal_criteria: '' }
    await call({ leadId: 1, linkedinUrl: 'https://www.linkedin.com/in/x-y/' })

    const prompt = h.prompts[0]
    expect(prompt).toMatch(/Use ONLY the facts listed below/)
    expect(prompt).toMatch(/You cannot see the LinkedIn profile/)
    expect(prompt).not.toMatch(/plausible/i)
    expect(prompt).not.toMatch(/realistic/i)
  })

  it('only carries facts the CRM actually holds', async () => {
    h.lead = { id: 1, name: 'X', firm_name: 'Real Firm Ltd', lead_type: '', notes: '', deal_criteria: '' }
    await call({ leadId: 1, linkedinUrl: 'https://www.linkedin.com/in/x-y/' })
    const prompt = h.prompts[0]
    expect(prompt).toContain('Real Firm Ltd')
    // Blank fields are omitted rather than sent as "Unknown", which is what
    // invited the model to fill the gap in the first place.
    expect(prompt).not.toMatch(/Unknown/)
  })
})

describe('nothing on file is an honest answer', () => {
  it('skips the model call entirely and says so', async () => {
    h.lead = { id: 900, name: '', firm_name: '', lead_type: '', notes: '', deal_criteria: '' }
    const r = await call({ leadId: 900, linkedinUrl: 'https://www.linkedin.com/in/jarydkrause/' })

    expect(h.prompts).toHaveLength(0)
    expect(r.body.enrichment.insufficient_context).toBe(true)
    expect(r.body.enrichment.enrichment_notes).toBe('')
    expect(leadWrites().at(-1).payload.enrichment_status).toBe('no_context')
  })
})

describe('preview mode', () => {
  it('derives the name from the slug and touches no rows', async () => {
    const r = await call({
      linkedinUrl: 'https://www.linkedin.com/in/amine-boukioud/',
      context: { firm_name: 'Real Firm Ltd' }
    })
    expect(r.body.enrichment.suggested_name).toBe('Amine Boukioud')
    expect(leadWrites()).toHaveLength(0)
  })

  it('returns no name rather than a guess for a run-together slug', async () => {
    const r = await call({
      linkedinUrl: 'https://www.linkedin.com/in/liroyhaddad/',
      context: { firm_name: 'Real Firm Ltd' }
    })
    expect(r.body.enrichment.suggested_name).toBe('')
  })

  it('drops a lead type outside the allowed list', async () => {
    h.reply = { summary: 'ok', suggested_lead_type: 'Sovereign Wealth Fund' }
    const r = await call({
      linkedinUrl: 'https://www.linkedin.com/in/amine-boukioud/',
      context: { firm_name: 'Real Firm Ltd' }
    })
    expect(r.body.enrichment.suggested_lead_type).toBe('')
  })

  it('rejects a URL that is not a personal profile', async () => {
    const r = await call({ linkedinUrl: 'https://www.linkedin.com/company/pocket-fund' })
    expect(r.statusCode).toBe(400)
  })
})
