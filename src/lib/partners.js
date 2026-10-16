// Partner pipeline vocabulary (crm_partners) — pure, so the Partners board
// and the HTTP/MCP API (api/_partners.js) share one definition and cannot
// drift. Stages are a closed set; categories are open-ended (the board lets
// anyone add one), normalised to a stable key by categoryKeyFromLabel.

export const PARTNER_STAGES = [
  { key: 'potential', label: 'Potential', color: '#a78bfa' },
  { key: 'reached_out', label: 'Reached Out', color: '#60a5fa' },
  { key: 'in_conversation', label: 'In Conversation', color: '#fbbf24' },
  { key: 'active_partner', label: 'Active Partner', color: '#22c55e' },
  { key: 'passed', label: 'Passed', color: '#9ca3af' }
]

export const PARTNER_STAGE_KEYS = PARTNER_STAGES.map(s => s.key)

// Normalize a free-text category name to a stable key (lowercased, spaces
// and other separators collapsed to underscores).
export function categoryKeyFromLabel(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
}
