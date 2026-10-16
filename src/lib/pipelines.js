// Board vocabularies for the non-lead pipelines — pure, so each board and the
// MCP server (api/_mcp-tools.js) share ONE definition. A stage the board does
// not list would make a record vanish from every column, so the server
// validates against these rather than accepting any string.

// Indian sellers (crm_sellers) — buyside acquisition pipeline.
export const SELLER_STAGES = [
  { key: 'sourced',    label: 'Sourced',    color: '#a78bfa' },
  { key: 'contacted',  label: 'Contacted',  color: '#60a5fa' },
  { key: 'intro_call', label: 'Intro Call', color: '#06b6d4' },
  { key: 'evaluating', label: 'Evaluating', color: '#fbbf24' },
  { key: 'loi_offer',  label: 'LOI/Offer',  color: '#f97316' },
  { key: 'acquired',   label: 'Acquired',   color: '#22c55e' },
  { key: 'passed',     label: 'Passed',     color: '#9ca3af' },
]

// Italy pipeline (crm_italy_pipeline) contact types — mirrored by a CHECK in migration 059.
export const ITALY_CONTACT_TYPES = [
  { key: 'seller', label: 'Seller', color: '#a78bfa' },
  { key: 'buyer',  label: 'Buyer',  color: '#60a5fa' },
  { key: 'broker', label: 'Broker', color: '#f97316' },
  { key: 'other',  label: 'Other',  color: '#9ca3af' },
]

// Italy pipeline stages.
export const ITALY_STAGES = [
  { key: 'sourced',   label: 'Sourced',   color: '#a78bfa' },
  { key: 'contacted', label: 'Contacted', color: '#60a5fa' },
  { key: 'engaged',   label: 'Engaged',   color: '#06b6d4' },
  { key: 'active',    label: 'Active',    color: '#fbbf24' },
  { key: 'closed',    label: 'Closed',    color: '#22c55e' },
  { key: 'passed',    label: 'Passed',    color: '#9ca3af' },
]

// PE OS demos (crm_demos).
export const DEMO_STAGES = [
  { key: 'scheduled',  label: 'Scheduled',  color: '#a78bfa' },
  { key: 'done',       label: 'Demo Done',  color: '#60a5fa' },
  { key: 'signed_up',  label: 'Signed Up',  color: '#22c55e' },
  { key: 'passed',     label: 'Passed',     color: '#9ca3af' }
]
