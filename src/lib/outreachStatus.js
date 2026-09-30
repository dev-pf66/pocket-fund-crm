/**
 * Outreach status vocabulary for crm_outreach_log.status — the one list every
 * status dropdown renders, and the one definition of "they responded".
 *
 * `rejected` is a REPLY: they answered, the answer was no. Same reasoning as
 * a call's `not_interested` → 'replied' (callOutcomes.js). Counting it as no
 * reply would make reply rate punish a clean no. So every reply count reads
 * isReply()/REPLY_STATUSES, never `status === 'replied'`.
 *
 * `follow_up_1` / `follow_up_2` are still awaiting a reply, like `sent`.
 */
export const OUTREACH_STATUSES = [
  { value: 'sent',        label: 'Sent' },
  { value: 'follow_up_1', label: 'Follow Up 1' },
  { value: 'follow_up_2', label: 'Follow Up 2' },
  { value: 'replied',     label: 'Replied' },
  { value: 'rejected',    label: 'Rejected' },
  { value: 'no_response', label: 'No Response' },
  { value: 'bounced',     label: 'Bounced' },
]

export const REPLY_STATUSES = ['replied', 'rejected']

// Un-replied statuses the pipeline back-sync may flip to 'replied'.
export const AWAITING_STATUSES = ['sent', 'follow_up_1', 'follow_up_2', 'no_response']

export function isReply(status) {
  return REPLY_STATUSES.includes(status)
}

// Map free-text CSV values into the canonical keys the dropdowns use.
export function normalizeOutreachStatus(raw) {
  const v = String(raw || '').toLowerCase().trim()
  if (!v) return null
  if (OUTREACH_STATUSES.some(s => s.value === v)) return v
  if (v.includes('reject') || v.includes('declin') || v.includes('not interested')) return 'rejected'
  if (/^(fu|follow[\s_-]*up)[\s_-]*2$/.test(v)) return 'follow_up_2'
  if (/^(fu|follow[\s_-]*up)[\s_-]*1?$/.test(v)) return 'follow_up_1'
  if (v.includes('repli') || v.includes('respond') || v.includes('conversation') || v === 'yes' || v === 'got reply') return 'replied'
  if (v.includes('bounce')) return 'bounced'
  if (v.includes('no response') || v === 'no') return 'no_response'
  return 'sent'
}
