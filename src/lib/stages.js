// Canonical pipeline stage metadata — short label + color for each stage.
// One source of truth so stage chips read the same on every surface
// (kanban, LeadDetail, Dashboard alerts). The kanban keeps its own longer
// column labels ("New Leads" etc.); this is the compact/chip vocabulary.
export const STAGE_META = {
  outreach:       { label: 'Outreach', color: '#60a5fa' },
  responded:      { label: 'Responded', color: '#06b6d4' },
  meeting_booked: { label: 'Meeting',   color: '#ec4899' },
  warm_active:    { label: 'Warm',      color: '#fbbf24' },
  client:         { label: 'Client',    color: '#22c55e' },
  passed:         { label: 'Passed',    color: '#9ca3af' },
}

// Falls back to a humanized label + neutral gray for any unknown key.
export function stageMeta(key) {
  return STAGE_META[key] || { label: (key || '').replace(/_/g, ' '), color: '#9ca3af' }
}
