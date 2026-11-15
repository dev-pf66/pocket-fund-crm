import { Calendar } from 'lucide-react'
import { followUpStatus } from '../lib/followUpBadge'

/**
 * The follow-up badge every board shows (src/lib/followUpBadge.js decides
 * when). Pass `date`, or a precomputed `status` when the caller already has it.
 */
export default function FollowUpBadge({ date, status, className = '' }) {
  const s = status ?? followUpStatus(date)
  if (!s) return null
  return (
    <span className={`fu-badge fu-badge--${s.kind} ${className}`} title={date ? `Follow-up ${String(date).slice(0, 10)}` : undefined}>
      <Calendar size={10} aria-hidden="true" /> {s.label}
    </span>
  )
}
