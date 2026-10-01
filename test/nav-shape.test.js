// Guardrails for the left-menu shape.
//
// The menu is the app's table of contents and it grows by accretion — every
// feature wants a tab. It reached 14 items for an analyst, 7 of them in the
// daily group, which made "which page do I use?" a real question and is the
// problem the Sept 2026 consolidation exists to fix. Nothing in the repo
// checked the shape, and there is no component-test setup here, which is why
// src/lib/nav.js is pure data and this file tests it directly.
//
// The rules that matter, and that a later "just add one more tab" would undo:
//
//  1. Today, Notifications and Dashboard are ONE entry, not three. They were
//     three answers to "what should I do today".
//  2. Removing a tab must not remove a ROUTE. Nothing is deleted in this
//     codebase; the pages stay reachable by deep link and the command palette.
//  3. The overdue badge must ride on Today. It used to live on the
//     Notifications entry, and deleting that entry would otherwise delete the
//     only "you are behind" signal in the chrome.
//  4. Log is admin-only. Team-wide outreach history is not an analyst surface.
//  5. The five contact tables stay (Dev's standing July 2026 decision).

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { buildNavGroups, navRoutes } from '../src/lib/nav.js'

const analyst = { isAdmin: false }
const admin = { isAdmin: true }

const appJsx = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const routeExists = (path) => appJsx.includes(`path="${path}"`)

describe('the menu is short', () => {
  it('gives an analyst 11 items, not 14', () => {
    expect(navRoutes(analyst)).toHaveLength(11)
  })

  it('gives the daily group 3 items for an analyst, 4 for an admin', () => {
    const daily = (o) => buildNavGroups(o).find(g => g.label === 'Daily Work').items
    expect(daily(analyst)).toHaveLength(3)
    expect(daily(admin)).toHaveLength(4)
  })

  it('drops a group entirely when nothing in it is visible', () => {
    // Setup collapses to Help alone for an analyst; it must not render as an
    // empty labelled group.
    for (const g of buildNavGroups(analyst)) expect(g.items.length).toBeGreaterThan(0)
  })
})

describe('Today is one entry, not three', () => {
  it('has no separate Notifications or Dashboard tab', () => {
    const routes = navRoutes(admin)
    expect(routes).toContain('/today')
    expect(routes).not.toContain('/notifications')
    expect(routes).not.toContain('/dashboard')
  })

  it('carries the notification badge, so the overdue signal survives the merge', () => {
    const today = buildNavGroups({ isAdmin: false, notifications: { total: 7, overdue: 3 } })
      .find(g => g.label === 'Daily Work').items
      .find(i => i.to === '/today')

    expect(today.badge).toBe(7)
    expect(today.badgeUrgent).toBe(true)
  })

  it('is not urgent when nothing is overdue', () => {
    const today = buildNavGroups({ notifications: { total: 2, overdue: 0 } })
      .find(g => g.label === 'Daily Work').items[0]
    expect(today.badgeUrgent).toBe(false)
  })

  it('survives being given no notification counts at all', () => {
    const today = buildNavGroups({}).find(g => g.label === 'Daily Work').items[0]
    expect(today.badge).toBeUndefined()
    expect(today.badgeUrgent).toBe(false)
  })
})

describe('no tab was removed by deleting a page', () => {
  it.each(['notifications', 'dashboard', 'outreach-queue'])(
    '/%s is still a live route even though it left the menu',
    (path) => {
      expect(navRoutes(admin)).not.toContain(`/${path}`)
      expect(routeExists(path)).toBe(true)
    }
  )

  it('every menu entry points at a route that exists', () => {
    for (const to of navRoutes(admin)) {
      expect(routeExists(to.replace(/^\//, ''))).toBe(true)
    }
  })
})

describe('what stays', () => {
  it('keeps Log for admins only — team-wide history is not an analyst surface', () => {
    expect(navRoutes(admin)).toContain('/outreach-admin')
    expect(navRoutes(analyst)).not.toContain('/outreach-admin')
  })

  it('keeps Tracker and Cold Calls for everyone', () => {
    expect(navRoutes(analyst)).toContain('/outreach')
    expect(navRoutes(analyst)).toContain('/cold-calls')
  })

  it('keeps all five contact tables — Dev\'s standing July 2026 decision — plus Italy Pipeline (Oct 2026)', () => {
    const pipelines = buildNavGroups(analyst).find(g => g.label === 'Pipelines').items.map(i => i.to)
    expect(pipelines).toEqual(
      expect.arrayContaining(['/pipeline', '/pe-os', '/sellers', '/investors', '/partners', '/italy'])
    )
    expect(pipelines).toHaveLength(6)
  })

  it('keeps Setup admin-gated apart from Help', () => {
    expect(navRoutes(analyst)).toContain('/help')
    for (const to of ['/templates', '/samples', '/admin']) {
      expect(navRoutes(analyst)).not.toContain(to)
      expect(navRoutes(admin)).toContain(to)
    }
  })
})
