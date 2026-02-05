import { useState, useEffect } from 'react'
import { getCRMSettings, calculateStaleness } from '../../lib/crm-api'
import StalenessBadge from './StalenessBadge'

function LeadCard({ lead, onDragStart, onClick, onRefresh }) {
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    try {
      const data = await getCRMSettings()
      setSettings(data)
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

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

  return (
    <div
      className="lead-card"
      draggable
      onDragStart={(e) => onDragStart(e, lead)}
      onClick={onClick}
    >
      <div className="lead-card-header">
        <h4>{lead.name}</h4>
        {settings && (
          <StalenessBadge lead={lead} settings={settings} />
        )}
      </div>

      <div className="lead-card-body">
        {lead.firm_name && (
          <p className="lead-firm">{lead.firm_name}</p>
        )}

        {lead.lead_type && (
          <span className="lead-type-badge">{lead.lead_type}</span>
        )}

        {lead.needs_sample_deals && (
          <div className="lead-flag">
            📋 Needs samples
          </div>
        )}

        {lead.next_follow_up_date && (
          <div className="lead-flag">
            📅 Follow up: {new Date(lead.next_follow_up_date).toLocaleDateString()}
          </div>
        )}

        {lead.reach_out_later_date && (
          <div className="lead-flag">
            🔔 Reach out: {new Date(lead.reach_out_later_date).toLocaleDateString()}
          </div>
        )}
      </div>

      <div className="lead-card-footer">
        <span className="lead-last-activity">
          {activityTypeEmoji[lead.last_activity_type] || '•'} {formatTimeAgo(lead.last_activity_date)}
        </span>
      </div>
    </div>
  )
}

export default LeadCard
