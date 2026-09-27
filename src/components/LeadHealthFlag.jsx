import { useState } from 'react'
import { AlertTriangle, FileText, Clock } from 'lucide-react'
import { missingRequiredFields, isStaleBreach, daysSinceTouch, daysOverClock, shouldSurfaceBreach, STALE_BREACH_DAYS } from '../lib/leadHealth'
import DispositionModal from './DispositionModal'

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
function LeadHealthFlag({ lead, hasTranscript = null, onUpdated }) {
  const [showDisposition, setShowDisposition] = useState(false)
  if (!lead || lead.is_archived) return null

  const missing = missingRequiredFields(lead)
  const stale = isStaleBreach(lead)
  const surfacing = shouldSurfaceBreach(lead)
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
            <strong>No update in {staleDays} days</strong> and nothing scheduled — {daysOverClock(lead)} days
            past the {STALE_BREACH_DAYS}-day mark
            {!surfacing && <> (older backlog, so it is not in this week&rsquo;s queue — still needs an answer)</>}.
            {' '}
            {/* One click from the warning to the fix. A flag that tells you off
                without offering the action is why nobody actioned it. */}
            <button
              onClick={() => setShowDisposition(true)}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                color: '#92400e', fontWeight: 700, textDecoration: 'underline'
              }}
            >
              Say what is happening
            </button>
          </span>
        </div>
      )}

      {showDisposition && (
        <DispositionModal
          lead={lead}
          onClose={() => setShowDisposition(false)}
          onDone={onUpdated}
        />
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
