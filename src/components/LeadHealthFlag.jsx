import { AlertTriangle, FileText, Clock } from 'lucide-react'
import { missingRequiredFields, isStaleBreach, daysSinceTouch, STALE_BREACH_DAYS } from '../lib/leadHealth'

/**
 * The flag, not a gate.
 *
 * Dev's ruling: "it will be a basic flag if it's not all the info." So this
 * renders a banner naming what is missing and nothing here prevents saving,
 * moving or working the lead. A hard gate in a shared CRM gets worked around,
 * and what comes back is a lead with invented data in it instead of a lead with
 * a flag on it — this database already carries three leads with fabricated
 * enrichment, so that is not hypothetical.
 *
 * Three things it reports, all from src/lib/leadHealth.js so the badge here can
 * never disagree with the count on the scoreboard:
 *   - required info missing for the stage the lead has actually reached
 *   - the running 30-day clock, expired
 *   - meeting stage or beyond with no transcript on file
 *
 * `hasTranscript` is passed in because transcripts live in another table; pass
 * null (or omit it) when the caller has not looked, and no transcript claim is
 * made. Never report a missing transcript we did not check for.
 */
function LeadHealthFlag({ lead, hasTranscript = null }) {
  if (!lead || lead.is_archived) return null

  const missing = missingRequiredFields(lead)
  const stale = isStaleBreach(lead)
  const staleDays = daysSinceTouch(lead)
  const reachedMeeting = ['meeting_booked', 'warm_active', 'client'].includes(lead.stage)
  const needsTranscript = hasTranscript !== null && reachedMeeting && !hasTranscript

  if (!missing.length && !stale && !needsTranscript) return null

  return (
    <div
      className="card"
      style={{
        padding: '12px 16px', marginBottom: '16px',
        background: '#fffbeb', border: '1px solid #fde68a',
        display: 'flex', flexDirection: 'column', gap: '8px'
      }}
    >
      {missing.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '14px', color: '#92400e' }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            <strong>Missing info</strong> for a lead at this stage:{' '}
            {missing.map(f => f.label).join(', ')}.
            {' '}<span style={{ color: '#a16207' }}>Fill it in below — nothing is blocked.</span>
          </span>
        </div>
      )}

      {stale && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '14px', color: '#92400e' }}>
          <Clock size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            <strong>No touch in {staleDays} days</strong> and nothing scheduled — past the{' '}
            {STALE_BREACH_DAYS}-day mark. Either work it, book a date, or mark it passed.
          </span>
        </div>
      )}

      {needsTranscript && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '14px', color: '#92400e' }}>
          <FileText size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            <strong>No transcript</strong> on a lead that has reached the meeting stage. Paste one
            in Transcripts below — it is what the next person reads before they call.
          </span>
        </div>
      )}
    </div>
  )
}

export default LeadHealthFlag
