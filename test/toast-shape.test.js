// Guardrail: `useToast().toast` is an OBJECT ({ error, success, info, warn }),
// never a function.
//
// ColdCalls called it as `toast?.(msg, type)` at 13 sites. Optional chaining
// only short-circuits on null/undefined, so on an object it throws
// "toast is not a function". The worst one ran right after logCall succeeded:
// the throw skipped advance(), so the dial was saved but Call Mode stayed on the
// same lead, inviting a second press that logged the same dial twice. Every
// load/save error on that screen was swallowed the same way.
//
// Code that wants to pass one function down as a prop takes `notify` from
// useToast() instead. This test scans every file that destructures `toast`
// from useToast() and fails if it calls `toast(...)` / `toast?.(...)` anywhere.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) return walk(p)
    return /\.(jsx?|tsx?)$/.test(d.name) ? [p] : []
  })
}

// Comments quote the broken form to explain it; only scan code.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('toast is an object, notify is the function', () => {
  const files = walk(SRC)

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  // Every `toast` in this codebase is the object — whether it came straight
  // from useToast() or was handed down as a prop (which is how ColdCalls hid
  // it). So no file anywhere may call `toast(...)` / `toast?.(...)`.
  it('nothing calls `toast` as a function, wherever it came from', () => {
    const offenders = []
    for (const f of files) {
      const code = stripComments(fs.readFileSync(f, 'utf8'))
      const calls = code.match(/(^|[^.\w])toast\s*(\?\.)?\s*\(/gm)
      if (calls) offenders.push(`${path.relative(SRC, f)} (${calls.length})`)
    }
    expect(offenders).toEqual([])
  })

  it('the provider exposes a callable notify alongside the toast object', () => {
    const code = stripComments(fs.readFileSync(path.join(SRC, 'components/Toast.jsx'), 'utf8'))
    expect(code).toMatch(/const notify = useCallback\(/)
    expect(code).toMatch(/\(\{ toast, notify \}\)/)
  })

  it('ColdCalls hands its sub-views notify, not the toast object', () => {
    const code = stripComments(fs.readFileSync(path.join(SRC, 'pages/ColdCalls.jsx'), 'utf8'))
    expect(code).toMatch(/const \{ notify \} = useToast\(\)/)
    expect(code).not.toMatch(/toast=\{toast\}/)
  })
})
