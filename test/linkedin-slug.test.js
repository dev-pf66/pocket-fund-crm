// Guardrails for deriving a name from a LinkedIn profile URL.
//
// These encode a data-quality rule, not just behaviour: a slug we cannot
// split is not a name. The old version title-cased whatever it found, which
// filed 126 of 807 leads under fake-looking names — "Liroyhaddad",
// "Sameerrizvi1", "Wilson1wu" — that read as real in outreach copy. Returning
// '' is the signal for "ask the user"; every caller depends on it.

import { describe, it, expect } from 'vitest'
import {
  nameFromLinkedInUrl,
  placeholderNameFromLinkedInUrl,
  linkedInProfileSlug,
  normalizeLinkedInUrl
} from '../src/lib/linkedin.js'

describe('nameFromLinkedInUrl', () => {
  it('splits a clean two-part slug', () => {
    expect(nameFromLinkedInUrl('https://www.linkedin.com/in/amine-boukioud/')).toBe('Amine Boukioud')
  })

  it("drops LinkedIn's trailing disambiguating id", () => {
    expect(nameFromLinkedInUrl('https://linkedin.com/in/deepak-chandrasekar-7968bb16'))
      .toBe('Deepak Chandrasekar')
  })

  it('refuses to guess at a run-together slug', () => {
    // These are real slugs behind real leads. Each previously produced a
    // capitalised non-name that went straight into the CRM.
    for (const slug of ['liroyhaddad', 'christiancoutts', 'ataeftekhari', 'danielrocznik']) {
      expect(nameFromLinkedInUrl(`https://www.linkedin.com/in/${slug}/`)).toBe('')
    }
  })

  it('refuses a slug with a digit left inside a segment', () => {
    expect(nameFromLinkedInUrl('https://linkedin.com/in/sameerrizvi1')).toBe('')
    expect(nameFromLinkedInUrl('https://linkedin.com/in/wilson1wu')).toBe('')
    expect(nameFromLinkedInUrl('https://linkedin.com/in/freddiezhang1')).toBe('')
  })

  it('returns nothing for non-profile LinkedIn URLs', () => {
    expect(nameFromLinkedInUrl('https://www.linkedin.com/company/pocket-fund')).toBe('')
    expect(nameFromLinkedInUrl('https://www.linkedin.com/')).toBe('')
    expect(nameFromLinkedInUrl('not a url')).toBe('')
  })
})

describe('placeholderNameFromLinkedInUrl', () => {
  it('falls back to a visible handle, not a fake name', () => {
    expect(placeholderNameFromLinkedInUrl('https://www.linkedin.com/in/liroyhaddad/'))
      .toBe('@liroyhaddad')
  })

  it('is empty when there is no profile slug to fall back to', () => {
    expect(placeholderNameFromLinkedInUrl('https://www.linkedin.com/company/pocket-fund')).toBe('')
  })
})

describe('linkedInProfileSlug', () => {
  it('reads only /in/ paths', () => {
    expect(linkedInProfileSlug('https://www.linkedin.com/in/john-smith/')).toBe('john-smith')
    expect(linkedInProfileSlug('https://www.linkedin.com/in/john-smith?trk=abc')).toBe('john-smith')
    expect(linkedInProfileSlug('https://www.linkedin.com/company/acme')).toBe('')
  })
})

describe('normalizeLinkedInUrl', () => {
  it('collapses the variants that would otherwise dodge a dedup check', () => {
    const canonical = 'https://linkedin.com/in/john-smith'
    for (const variant of [
      'https://www.linkedin.com/in/john-smith',
      'https://www.linkedin.com/in/john-smith/',
      'http://linkedin.com/in/john-smith',
      'https://LinkedIn.com/in/John-Smith/',
      'https://www.linkedin.com/in/john-smith?originalSubdomain=in'
    ]) {
      expect(normalizeLinkedInUrl(variant)).toBe(canonical)
    }
  })
})
