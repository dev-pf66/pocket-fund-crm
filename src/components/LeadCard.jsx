import { useState, useCallback, memo } from 'react'
import { logActivity } from '../lib/crm-api'
import { useApp } from '../App'
import StalenessBadge from './StalenessBadge'
import { Phone, Mail, MessageCircle, AtSign, Linkedin } from 'lucide-react'

// Pick a single urgency cue for the card header. Priority order matters
// because we only show one dot — overdue follow-ups should win over a
// recent reply. Stages that are terminal (client / passed) are quiet.
function urgencyForLead(lead, latestOutreachStatus) {
  const terminal = lead.stage === 'client' || lead.stage === 'passed'
  if (!terminal && lead.next_follow_up_date) {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const due = new Date(lead.next_follow_up_date + 'T00:00:00')
    if (due < today) return { color: '#dc2626', title: 'Follow-up overdue' }
    if (due.getTime() === today.getTime()) return { color: '#d97706', title: 'Follow-up due today' }
  }
  if (latestOutreachStatus === 'replied') return { color: '#16a34a', title: 'Replied' }
  if (latestOutreachStatus === 'bounced') return { color: '#dc2626', title: 'Outreach bounced' }
  return null
}

const LeadCard = memo(function LeadCard({ lead, settings, latestOutreachStatus, onDragStart, onClick, onRefresh, selected, onToggleSelect }) {
  const { currentPerson, people } = useApp()
  const [logging, setLogging] = useState(false)
  const addedByName = people?.find(p => p.id === lead.created_by)?.name

  const handleQuickLog = useCallback(async function handleQuickLog(e, activityType) {
    e.stopPropagation()
    if (logging) return

    setLogging(true)
    try {
      await logActivity(lead.id, {
        activity_type: activityType,
        notes: `Quick log from pipeline`
      }, currentPerson?.id)

      if (onRefresh) onRefresh()
    } catch (error) {
      console.error('Failed to log activity:', error)
    } finally {
      setLogging(false)
    }
  }, [lead.id, currentPerson?.id, onRefresh, logging])

  function formatTimeAgo(date) {
    if (!date) return 'Never'

    const now = new Date()
    const activityDate = new Date(date)
    const diffMs = now - activityDate
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffMins = Math.floor(diffMs / (1000 * 60))

    if (diffDays > 0) return `${diffDays}d ago`
    if (diffHours > 0) return `${diffHours}h ago`
    if (diffMins > 0) return `${diffMins}m ago`
    return 'Just now'
  }

  const activityTypeEmoji = {
    call: '📞',
    email: '📧',
    linkedin_message: '💼',
    meeting: '🤝',
    sample_sent: '📎',
    proposal_sent: '📄',
    note: '📝',
    created: '✨'
  }

  const urgency = urgencyForLead(lead, latestOutreachStatus)

  return (
    <div
      className="lead-card"
      draggable
      onDragStart={(e) => onDragStart(e, lead)}
      onClick={onClick}
    >
      <div className="lead-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={onToggleSelect}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={`Select ${lead.name || 'lead'}`}
              style={{ width: '14px', height: '14px', flexShrink: 0, cursor: 'pointer' }}
            />
          )}
          {urgency && (
            <span
              title={urgency.title}
              style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: urgency.color, flexShrink: 0
              }}
            />
          )}
          <h4 style={{ margin: 0, minWidth: 0 }}>{lead.name}</h4>
        </div>
        {settings && (
          <StalenessBadge lead={lead} settings={settings} />
        )}
      </div>

      <div className="lead-card-body">
        {lead.firm_name && (
          <p className="lead-firm">{lead.firm_name}</p>
        )}

        {addedByName && (
          <div style={{ fontSize: '10px', color: '#9ca3af', fontStyle: 'italic' }}>
            Added by {addedByName}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
          {lead.lead_type && (
            <span className="lead-type-badge">{lead.lead_type}</span>
          )}
          {/* Compact contact-method icons — at-a-glance tells you what
              channels you have available, instead of a heavy "Has Email"
              flag. Muted when missing. */}
          <span title={lead.email ? `Email: ${lead.email}` : 'No email on file'}
                style={{ color: lead.email ? '#16a34a' : '#d1d5db', display: 'inline-flex' }}>
            <AtSign size={12} />
          </span>
          <span title={lead.phone ? `Phone: ${lead.phone}` : 'No phone on file'}
                style={{ color: lead.phone ? '#16a34a' : '#d1d5db', display: 'inline-flex' }}>
            <Phone size={12} />
          </span>
          <span title={lead.linkedin_url ? lead.linkedin_url : 'No LinkedIn on file'}
                style={{ color: lead.linkedin_url ? '#0a66c2' : '#d1d5db', display: 'inline-flex' }}>
            <Linkedin size={12} />
          </span>
        </div>

        {lead.needs_sample_deals && (
          <div className="lead-flag" style={{ fontSize: '11px' }}>
            📋 Needs samples
          </div>
        )}

        {lead.next_follow_up_date && (
          <div className="lead-flag" style={{
            fontSize: '11px',
            color: urgency?.color === '#dc2626' ? '#dc2626'
                 : urgency?.color === '#d97706' ? '#d97706'
                 : undefined
          }}>
            📅 Follow up: {new Date(lead.next_follow_up_date).toLocaleDateString()}
          </div>
        )}

        {lead.reach_out_later_date && (
          <div className="lead-flag" style={{ fontSize: '11px' }}>
            🔔 Reach out: {new Date(lead.reach_out_later_date).toLocaleDateString()}
          </div>
        )}
      </div>

      <div className="lead-card-footer">
        <span className="lead-last-activity">
          {activityTypeEmoji[lead.last_activity_type] || '•'} {formatTimeAgo(lead.last_activity_date)}
        </span>
        <div className="lead-quick-actions">
          <button
            className="quick-action-btn"
            onClick={(e) => handleQuickLog(e, 'call')}
            disabled={logging}
            title="Log call"
          >
            <Phone size={14} />
          </button>
          <button
            className="quick-action-btn"
            onClick={(e) => handleQuickLog(e, 'email')}
            disabled={logging}
            title="Log email"
          >
            <Mail size={14} />
          </button>
          <button
            className="quick-action-btn"
            onClick={(e) => handleQuickLog(e, 'linkedin_message')}
            disabled={logging}
            title="Log LinkedIn message"
          >
            <MessageCircle size={14} />
          </button>
        </div>
      </div>
    </div>
  )
})

export default LeadCard
