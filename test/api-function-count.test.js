// Guardrail: the Hobby plan caps a deployment at 12 Serverless Functions.
//
// api/tags.js was the 13th top-level api/*.js file (Oct 2026) — it built
// clean locally and in CI, passed every check here, and then failed every
// production deploy with `exceeded_serverless_functions_per_deployment`, a
// Vercel-side error with no code-level symptom to catch it. It was folded
// into api/leads.js?resource=tags instead (api/_tags.js), and the same
// pattern was used again for api/_mcp.js (?resource=mcp). Underscore-prefixed
// files are shared modules, not routes — Vercel does not count them.
//
// This test can't see Vercel's actual limit, only count what would ship. If
// it ever fails because a new top-level api/*.js file pushed the count past
// 12, that is the signal to dispatch the new route from an existing file
// (see api/_tags.js or api/_mcp.js) instead of adding one.

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const API_DIR = path.resolve(__dirname, '../api')
const HOBBY_PLAN_FUNCTION_CAP = 12

// Every api/**/*.js file is its own Serverless Function, at any depth
// (api/admin/reset-password.js and api/events/fire.js count same as a
// top-level one) — EXCEPT a file whose name starts with `_`, which Vercel
// treats as a shared module, not a route.
function countFunctions(dir) {
  let count = 0
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      count += countFunctions(full)
    } else if (name.endsWith('.js') && !name.startsWith('_')) {
      count += 1
    }
  }
  return count
}

describe('api/ serverless function count', () => {
  it('stays at or under the Hobby plan cap of 12 route files', () => {
    expect(countFunctions(API_DIR)).toBeLessThanOrEqual(HOBBY_PLAN_FUNCTION_CAP)
  })
})
