// Guardrails for the design tokens (UI batch 2, Nov 2026).
//
// 1. Every var(--x) the app uses must be defined. `--primary-light` was used
//    by the lead-type badge, ActivityFeed and two board rules for months
//    without ever being defined, so those backgrounds silently rendered
//    transparent. CSS gives no error for that — only this test does.
//
// 2. A ratchet on raw hex colours. The JSX carried 1,147 hex literals in a
//    different grey family from the tokens; batch 2 moved ~1,050 of them onto
//    var(--token). The ceilings below are the counts left after that move —
//    mostly per-board stage/data colours and one-off accents. They may go
//    DOWN freely (lower the number when you remove some); they may not go up.
//    New UI uses the semantic tokens in src/index.css :root (--text,
//    --text-muted, --danger-*, --warning-*, --success-*, --fs-*, --radius-*).

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname
const CSS = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g

const JSX_HEX_CEILING = 197 // ErrorBoundary keeps raw hex on purpose: it must render with no stylesheet
const CSS_HEX_CEILING = 38 // outside custom-property definitions

describe('design tokens', () => {
  const files = walk(SRC).filter(f => /\.(jsx?|css)$/.test(f))

  it('every var(--x) without a fallback is defined somewhere', () => {
    const defined = new Set()
    for (const f of files) {
      const code = fs.readFileSync(f, 'utf8')
      for (const m of code.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1])      // CSS definitions
      for (const m of code.matchAll(/['"](--[a-z0-9-]+)['"]\s*:/gi)) defined.add(m[1]) // style={{ '--chip': … }}
    }
    // .funnel-stage / .funnel-bar read --width/--color from an inline style, but
    // no component renders those classes any more (dead rules, left in place).
    for (const t of ['--width', '--color']) defined.add(t)
    const missing = new Set()
    for (const f of files) {
      const code = stripComments(fs.readFileSync(f, 'utf8'))
      for (const m of code.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/gi)) {
        if (m[2] === ')' && !defined.has(m[1])) missing.add(`${m[1]} (${path.relative(SRC, f)})`)
      }
    }
    expect([...missing]).toEqual([])
  })

  it('the semantic layer exists', () => {
    for (const t of ['--text', '--text-muted', '--danger-text', '--warning-text', '--success-text', '--fs-xs', '--fs-base', '--radius-pill', '--primary-light']) {
      expect(CSS).toMatch(new RegExp(`\\n\\s*${t}:`))
    }
  })

  it(`raw hex in pages/components stays at or below ${JSX_HEX_CEILING}`, () => {
    let n = 0
    for (const f of walk(path.join(SRC, 'pages')).concat(walk(path.join(SRC, 'components')))) {
      if (f.endsWith('.jsx')) n += (stripComments(fs.readFileSync(f, 'utf8')).match(HEX) || []).length
    }
    expect(n).toBeLessThanOrEqual(JSX_HEX_CEILING)
  })

  it(`raw hex in index.css declarations stays at or below ${CSS_HEX_CEILING}`, () => {
    const decls = stripComments(CSS).split('\n').filter(l => !/^\s*--[a-z0-9-]+\s*:/i.test(l)).join('\n')
    expect((decls.match(HEX) || []).length).toBeLessThanOrEqual(CSS_HEX_CEILING)
  })

  // Light grey (#94a3b8, 2.56:1) and amber (#f59e0b, 2.1:1) fail AA as text.
  // Checked in CSS AND inline styles, fallback forms included — the codemod's
  // first pass left `var(--gray-400, …)` behind, and since --gray-400 is always
  // defined the fallback never applied.
  it('light grey and amber are never used as a text colour', () => {
    const bad = /(^|[^-\w])color:\s*['"]?var\(--(gray-400|warning)\s*[,)]/m
    const offenders = files.filter(f => bad.test(stripComments(fs.readFileSync(f, 'utf8'))))
      .map(f => path.relative(SRC, f))
    expect(offenders).toEqual([])
  })
})
