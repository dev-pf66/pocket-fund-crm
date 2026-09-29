// Guardrails for the board's "needs attention" filter.
//
// The filter exists because a breach COUNT nobody can turn into rows is a count
// nobody looks at twice: 476 of 629 live leads had no channel on 2026-09-29 and
// the only way to find them was to read cards one at a time across five stage
// columns.
//
// What must not drift:
//
//  1. THE PREDICATES ARE NOT REDEFINED. Every option but one delegates to
//     `leadHealth`, so the dropdown, the flag on the lead page and the
//     scoreboard can never disagree about what is wrong with a lead.
//  2. `missing_channel` IS DELIBERATELY NOT STAGE-GATED, and that is the one
//     intentional difference from the policy. The flag only requires a channel
//     from `responded`; this option has to reach cold leads too, because a
//     40-lead import you know came off LinkedIn is answerable today. Making it
//     stage-aware would hide 379 of the 476 rows it exists to bulk-fill.
//  3. NEEDS UPDATE AND BACKLOG STAY APART, exactly as they do on the
//     scoreboard — this month's work vs debt (Dev's distinction) — and together
//     they account for every stale breach, so nothing falls between them.
//  4. AN UNKNOWN KEY MATCHES EVERYTHING. These filters persist in
//     sessionStorage; a renamed option must never silently empty the board.

import { describe, it, expect } from 'vitest'
import { HEALTH_FILTERS, matchesHealthFilter, healthFilterCounts } from '../src/lib/leadFilters.js'
import { isMissingInfo, isStaleBreach, shouldSurfaceBreach } from '../src/lib/leadHealth.js'

const NOW = new Date('2026-09-29T12:00:00+05:30')
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString()
const opts = { now: NOW }

// A lead that has replied and answers nothing — the shape the flag is for.
const respondedBlank = {
  id: 1, stage: 'responded', last_activity_date: daysAgo(1),
  email: null, phone: null, linkedin_url: null,
  lead_channel: null, lead_type: null,
}
// A cold lead that answers nothing. The policy requires nothing here.
const coldBlank = {
  id: 2, stage: 'outreach', last_activity_date: daysAgo(1),
  linkedin_url: 'https://linkedin.com/in/x', lead_channel: null, lead_type: null,
}
const complete = {
  id: 3, stage: 'responded', last_activity_date: daysAgo(1),
  email: 'a@b.com', linkedin_url: 'https://linkedin.com/in/y',
  lead_channel: 'Outbound — LinkedIn', lead_type: 'individual',
}

describe('the option list', () => {
  it('starts with "Any" so the default shows the whole board', () => {
    expect(HEALTH_FILTERS[0].value).toBe('all')
  })

  it('offers no channel, missing info, unreachable, needs update and backlog', () => {
    expect(HEALTH_FILTERS.map(f => f.value)).toEqual([
      'all', 'missing_channel', 'missing_info', 'unreachable', 'needs_update', 'backlog',
    ])
  })
})

describe('matchesHealthFilter', () => {
  it('"all" keeps every lead', () => {
    for (const lead of [respondedBlank, coldBlank, complete]) {
      expect(matchesHealthFilter(lead, 'all', opts)).toBe(true)
    }
  })

  it('an unknown or empty key keeps every lead rather than emptying the board', () => {
    expect(matchesHealthFilter(coldBlank, 'renamed_last_month', opts)).toBe(true)
    expect(matchesHealthFilter(coldBlank, '', opts)).toBe(true)
    expect(matchesHealthFilter(coldBlank, undefined, opts)).toBe(true)
  })
})

describe('missing_channel — the 476-lead backlog', () => {
  it('matches a blank channel at ANY stage, including cold leads', () => {
    expect(matchesHealthFilter(respondedBlank, 'missing_channel', opts)).toBe(true)
    // The whole point: not stage-gated. 379 of the 476 sit at `outreach`.
    expect(matchesHealthFilter(coldBlank, 'missing_channel', opts)).toBe(true)
  })

  it('treats an empty or whitespace string as blank', () => {
    expect(matchesHealthFilter({ ...complete, lead_channel: '' }, 'missing_channel', opts)).toBe(true)
    expect(matchesHealthFilter({ ...complete, lead_channel: '   ' }, 'missing_channel', opts)).toBe(true)
  })

  it('does not match once a channel is set', () => {
    expect(matchesHealthFilter(complete, 'missing_channel', opts)).toBe(false)
  })
})

describe('missing_info — delegates to the policy, stage and all', () => {
  it('agrees with isMissingInfo on every lead', () => {
    for (const lead of [respondedBlank, coldBlank, complete]) {
      expect(matchesHealthFilter(lead, 'missing_info', opts)).toBe(isMissingInfo(lead))
    }
  })

  it('flags a replied lead with nothing filled in', () => {
    expect(matchesHealthFilter(respondedBlank, 'missing_info', opts)).toBe(true)
  })

  it('does NOT flag a cold lead — nothing is required at outreach', () => {
    expect(matchesHealthFilter(coldBlank, 'missing_info', opts)).toBe(false)
  })
})

describe('unreachable', () => {
  it('matches only a lead with no email, phone or LinkedIn', () => {
    expect(matchesHealthFilter(respondedBlank, 'unreachable', opts)).toBe(true)
    expect(matchesHealthFilter(coldBlank, 'unreachable', opts)).toBe(false)
    expect(matchesHealthFilter({ ...respondedBlank, phone: '+91 90000 00000' }, 'unreachable', opts)).toBe(false)
  })
})

describe('needs_update vs backlog — the scoreboard distinction, kept', () => {
  const justOver = { id: 10, stage: 'responded', last_activity_date: daysAgo(35) }
  const longGone = { id: 11, stage: 'responded', last_activity_date: daysAgo(120) }
  const fresh = { id: 12, stage: 'responded', last_activity_date: daysAgo(3) }

  it('puts a recent breach in needs_update and not in backlog', () => {
    expect(matchesHealthFilter(justOver, 'needs_update', opts)).toBe(true)
    expect(matchesHealthFilter(justOver, 'backlog', opts)).toBe(false)
  })

  it('puts an old breach in backlog and not in needs_update', () => {
    expect(matchesHealthFilter(longGone, 'backlog', opts)).toBe(true)
    expect(matchesHealthFilter(longGone, 'needs_update', opts)).toBe(false)
  })

  it('leaves a freshly worked lead out of both', () => {
    expect(matchesHealthFilter(fresh, 'needs_update', opts)).toBe(false)
    expect(matchesHealthFilter(fresh, 'backlog', opts)).toBe(false)
  })

  it('together they account for every stale breach — nothing falls between', () => {
    for (const lead of [justOver, longGone, fresh, respondedBlank, complete]) {
      const either = matchesHealthFilter(lead, 'needs_update', opts) ||
                     matchesHealthFilter(lead, 'backlog', opts)
      expect(either).toBe(isStaleBreach(lead, opts))
    }
  })

  it('and needs_update is exactly the surfacing window', () => {
    for (const lead of [justOver, longGone, fresh]) {
      expect(matchesHealthFilter(lead, 'needs_update', opts)).toBe(shouldSurfaceBreach(lead, opts))
    }
  })

  it('a scheduled follow-up clears the clock, same as everywhere else', () => {
    const promised = { ...longGone, next_follow_up_date: '2026-10-05' }
    expect(matchesHealthFilter(promised, 'needs_update', { ...opts, today: '2026-09-29' })).toBe(false)
    expect(matchesHealthFilter(promised, 'backlog', { ...opts, today: '2026-09-29' })).toBe(false)
  })
})

describe('healthFilterCounts', () => {
  const book = [respondedBlank, coldBlank, complete]

  it('counts every lead under "all"', () => {
    expect(healthFilterCounts(book, opts).all).toBe(3)
  })

  it('counts what each option would show', () => {
    const c = healthFilterCounts(book, opts)
    expect(c.missing_channel).toBe(2)   // respondedBlank + coldBlank
    expect(c.missing_info).toBe(1)      // respondedBlank only — cold is exempt
    expect(c.unreachable).toBe(1)
  })

  it('survives an empty or missing book', () => {
    expect(healthFilterCounts([], opts).all).toBe(0)
    expect(healthFilterCounts(undefined, opts).all).toBe(0)
  })
})
