// Helpers for parsing and normalizing LinkedIn profile URLs.

export function isLinkedInUrl(url) {
  try {
    const host = new URL(url).hostname
    return host === 'linkedin.com' || host === 'www.linkedin.com' || host.endsWith('.linkedin.com')
  } catch {
    return false
  }
}

// Pull a "First Last" guess from a LinkedIn slug like "john-smith-ab12cd".
// Strips the trailing random ID segment LinkedIn tacks on and title-cases.
export function nameFromLinkedInUrl(url) {
  try {
    const path = new URL(url).pathname
    const slug = path.replace(/^\/in\//, '').replace(/\/$/, '')
    if (!slug) return ''
    const parts = slug.split('-').filter(Boolean)
    while (parts.length > 2 && /\d/.test(parts[parts.length - 1])) {
      parts.pop()
    }
    return parts.map(p => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ')
  } catch {
    return ''
  }
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
