// Helpers for parsing and normalizing LinkedIn profile URLs.

export function isLinkedInUrl(url) {
  try {
    const host = new URL(url).hostname
    return host === 'linkedin.com' || host === 'www.linkedin.com' || host.endsWith('.linkedin.com')
  } catch {
    return false
  }
}

// The profile slug from a /in/ URL — "john-smith-ab12cd". Empty string for
// anything that isn't a personal profile (/company/, /school/, a bare host).
export function linkedInProfileSlug(url) {
  try {
    const match = new URL(url).pathname.match(/^\/in\/([^/]+)/)
    return match ? decodeURIComponent(match[1]) : ''
  } catch {
    return ''
  }
}

// Pull a "First Last" guess from a LinkedIn slug like "john-smith-ab12cd".
//
// Returns '' when the slug has no boundary worth trusting. A run-together
// slug ("liroyhaddad", "wilson1wu") cannot be split back into a name, and
// guessing anyway is how 126 leads ended up filed under "Liroyhaddad" and
// "Sameerrizvi1". An empty return means "ask the user", not "no name".
export function nameFromLinkedInUrl(url) {
  const slug = linkedInProfileSlug(url)
  if (!slug) return ''

  const parts = slug.split('-').filter(Boolean)

  // LinkedIn appends a random disambiguating id to non-unique slugs; it is
  // always last and always contains a digit.
  while (parts.length > 2 && /\d/.test(parts[parts.length - 1])) {
    parts.pop()
  }

  // One segment left means the slug was run together — no boundary to split on.
  if (parts.length < 2) return ''
  // A digit still inside a segment means this isn't a clean name slug.
  if (parts.some(p => /\d/.test(p))) return ''

  return parts.map(p => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ')
}

// What to call a lead created from a URL alone when the slug won't split.
// A visible handle ("@liroyhaddad") beats a fake-looking name ("Liroyhaddad"):
// it reads as unresolved, it stays unique, it preserves the slug verbatim for
// a later backfill, and nobody mistakes it for something to greet someone by.
export function placeholderNameFromLinkedInUrl(url) {
  const slug = linkedInProfileSlug(url)
  return slug ? `@${slug}` : ''
}

// Canonical form for dedup comparisons: lowercased host without "www.",
// trailing slash stripped, querystring/hash dropped.
export function normalizeLinkedInUrl(url) {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/$/, '')
    return `https://${host}${path}`.toLowerCase()
  } catch {
    return (url || '').trim().toLowerCase()
  }
}
