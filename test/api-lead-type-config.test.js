// Guardrail: lead_type validation must read the admin-managed options table,
// not a hardcoded array.
//
// lead_type options live in crm_lead_type_options (migration 022) and the UI
// reads them through useLeadTypes, so an admin can add a type at any time.
// api/leads.js kept its own frozen copy of four values, which meant the app
// wrote a new type happily while this API — the PREFERRED access path for CRM
// data per CLAUDE.md — rejected it with a 400. Live data already contained CA,
// WealthMgr, Lawyer MA, vCFO, CS and PrivateBanker; none were writable through
// the front door, and adding "Partner" hit the same wall.
//
// Fallback behaviour matters as much as the lookup: a config read that fails
// must not fail the write, or an un-migrated project can create no leads at all.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ options: null, optionsError: null, inserted: null }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table) {
      const chain = {
        select() {
          if (table === 'crm_lead_type_options') {
            return Promise.resolve(
              h.optionsError ? { data: null, error: h.optionsError } : { data: h.options, error: null }
            )
          }
          return chain
        },
        eq() { return chain },
        single() { return Promise.resolve({ data: { id: 1, ...(h.inserted || {}) }, error: null }) },
        insert(payload) {
          if (table === 'crm_leads') h.inserted = Array.isArray(payload) ? payload[0] : payload
          return chain
        },
        update() { return chain },
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve) }
      }
      return chain
    }
  })
}))

process.env.VITE_SUPABASE_URL = 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.CRM_API_KEY = 'test-key'

const { default: handler } = await import('../api/leads.js')

function res() {
  const r = { statusCode: null, body: null, headers: {} }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.end = () => r
  return r
}

const post = (body) => ({ method: 'POST', headers: { 'x-api-key': 'test-key' }, query: {}, body })

beforeEach(() => { h.options = null; h.optionsError = null; h.inserted = null })

describe('POST /api/leads — lead_type reads the config table', () => {
  it('accepts an admin-added type that the old hardcoded list rejected', async () => {
    h.options = [{ name: 'PE Firm' }, { name: 'Other' }, { name: 'Partner' }]
    const r = res()
    await handler(post({ name: 'Bytera', lead_type: 'Partner' }), r)

    expect(r.statusCode).not.toBe(400)
    expect(h.inserted).toMatchObject({ name: 'Bytera', lead_type: 'Partner' })
  })

  it('still rejects a type that is in neither the table nor the defaults', async () => {
    h.options = [{ name: 'PE Firm' }, { name: 'Partner' }]
    const r = res()
    await handler(post({ name: 'Nope', lead_type: 'Wizard' }), r)

    expect(r.statusCode).toBe(400)
    expect(r.body.error).toContain('Invalid lead_type')
    expect(r.body.error).toContain('Partner')   // the error lists what IS allowed
  })

  it('falls back to the built-in defaults when the options read fails', async () => {
    h.optionsError = { message: 'relation "crm_lead_type_options" does not exist' }
    const r = res()
    await handler(post({ name: 'Acme', lead_type: 'PE Firm' }), r)

    expect(r.statusCode).not.toBe(400)
    expect(h.inserted).toMatchObject({ lead_type: 'PE Firm' })
  })

  it('does not block a create that omits lead_type entirely', async () => {
    h.optionsError = { message: 'boom' }
    const r = res()
    await handler(post({ name: 'No Type' }), r)

    expect(r.statusCode).not.toBe(400)
  })
})
