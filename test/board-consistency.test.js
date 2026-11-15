// Guardrails for board consistency (UI batch 3, Nov 2026).
//
// The six boards drifted apart one copy-paste at a time: three identical
// copies of the follow-up helpers, two different column headers, a one-click
// delete icon on four boards' cards but not the Pipeline's, four boards that
// blanked to a spinner on every refresh. These pin the shared pieces so the
// next board doesn't start the drift again.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { daysUntil, followUpStatus, FOLLOW_UP_SOON_DAYS } from '../src/lib/followUpBadge.js'

const PAGES = new URL('../src/pages/', import.meta.url).pathname
const KANBANS = ['LeadsBoard', 'SellersBoard', 'PartnersBoard', 'ItalyBoard', 'PEOSBoard']
const read = (f) => fs.readFileSync(path.join(PAGES, `${f}.jsx`), 'utf8')

describe('one follow-up badge', () => {
  const TODAY = '2026-11-16'
  it('counts days in calendar dates, not hours', () => {
    expect(daysUntil('2026-11-16', TODAY)).toBe(0)
    expect(daysUntil('2026-11-13T23:59:00+05:30', TODAY)).toBe(-3)
    expect(daysUntil('2026-12-16', TODAY)).toBe(30)
    expect(daysUntil(null, TODAY)).toBeNull()
    expect(daysUntil('not a date', TODAY)).toBeNull()
  })

  it('badges overdue, today and soon — and nothing further out', () => {
    expect(followUpStatus('2026-11-14', TODAY)).toMatchObject({ kind: 'overdue', label: '2d overdue' })
    expect(followUpStatus('2026-11-16', TODAY)).toMatchObject({ kind: 'today', label: 'Due today' })
    expect(followUpStatus('2026-11-19', TODAY)).toMatchObject({ kind: 'soon', label: `In ${FOLLOW_UP_SOON_DAYS}d` })
    // The automatic 30-day check-in must not put a badge on every card.
    expect(followUpStatus('2026-12-16', TODAY)).toBeNull()
  })

  it('no board keeps its own copy of the helpers', () => {
    for (const f of ['SellersBoard', 'PartnersBoard', 'ItalyBoard']) {
      expect(read(f), f).not.toMatch(/function (daysUntil|followUpStatus)\(/)
    }
  })
})

describe('kanban boards share one column anatomy', () => {
  it('every kanban uses BoardColumnHeader and BoardColumnEmpty', () => {
    for (const f of KANBANS) {
      const s = read(f)
      expect(s, f).toMatch(/<BoardColumnHeader /)
      expect(s, f).toMatch(/<BoardColumnEmpty /)
    }
  })

  // Desktop cards only: the mobile lists have no selection checkboxes, so their
  // per-row delete is the only way to delete on a phone and stays.
  it('no desktop card carries a one-click delete (bulk bar only, like the Pipeline)', () => {
    const cards = { SellersBoard: 'SellerCard', PartnersBoard: 'PartnerCard', ItalyBoard: 'ContactCard', PEOSBoard: 'DemoCard' }
    for (const [f, card] of Object.entries(cards)) {
      const s = read(f)
      const start = s.indexOf(`function ${card}(`)
      expect(start, `${f}: ${card} not found`).toBeGreaterThan(-1)
      const end = s.indexOf('\nfunction ', start + 1)
      const body = s.slice(start, end === -1 ? undefined : end)
      expect(body, `${f}: ${card}`).not.toMatch(/onDelete|Trash2/)
    }
  })

  it('a refresh does not blank the board to a spinner', () => {
    for (const f of ['SellersBoard', 'PartnersBoard', 'ItalyBoard', 'PEOSBoard']) {
      // Keyed on "has this view loaded once", not on data length — an empty
      // board is still a loaded board (PE OS keys it on whose demos are shown).
      expect(read(f), f).toMatch(/loadedScopeRef\.current[^\n]*\) setLoading\(true\)/)
      expect(read(f), f).not.toMatch(/^\s*setLoading\(true\)\s*$/m)
    }
  })

  it('a failed load is shown, not rendered as an empty board', () => {
    expect(read('LeadsBoard')).toMatch(/setLoadError\(error/)
    expect(read('Investors')).toMatch(/setLoadError\(error/)
  })
})
