import { useState, useEffect } from 'react'
import { getRecentActivity } from '../lib/crm-api'
import { Activity, User, UserPlus, Send, TrendingUp, CheckCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

function ActivityFeed({ limit = 15 }) {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadActivities()
    // Refresh every 30 seconds
    const interval = setInterval(loadActivities, 30000)
    return () => clearInterval(interval)
  }, [])

  async function loadActivities() {
    try {
      const data = await getRecentActivity(limit)
      setActivities(data)
    } catch (error) {
      console.error('Failed to load activities:', error)
      setActivities([])
    } finally {
      setLoading(false)
    }
  }

  function getActivityIcon(actionType) {
    switch (actionType) {
      case 'lead_created':
        return <UserPlus size={16} color="#3b82f6" />
      case 'lead_assigned':
        return <User size={16} color="#8b5cf6" />
      case 'outreach_logged':
        return <Send size={16} color="#10b981" />
      case 'status_changed':
        return <TrendingUp size={16} color="#f59e0b" />
      case 'lead_qualified':
        return <CheckCircle size={16} color="#06b6d4" />
      case 'lead_replied':
        return <CheckCircle size={16} color="#22c55e" />
      default:
        return <Activity size={16} color="#6b7280" />
    }
  }

  function getTimeAgo(timestamp) {
    const now = new Date()
    const then = new Date(timestamp)
    const seconds = Math.floor((now - then) / 1000)

    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  function getUserInitials(name) {
    if (!name) return '?'
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center', color: 'var(--gray-500)' }}>Loading activity...</div>
  }

  if (activities.length === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--gray-500)' }}>
        <Activity size={48} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
        <div>No recent activity yet</div>
        <div style={{ fontSize: '14px', marginTop: '8px' }}>Team actions will appear here</div>
      </div>
    )
  }

  return (
    <div className="activity-feed">
      {activities.map((activity) => (
        <div key={activity.id} className="activity-item" style={{
          display: 'flex',
          gap: '12px',
          padding: '12px',
          borderBottom: '1px solid var(--gray-100)',
          alignItems: 'flex-start'
        }}>
          {/* User Avatar */}
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'var(--primary-light)',
            color: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            fontWeight: '600',
            flexShrink: 0
          }}>
            {getUserInitials(activity.user_name)}
          </div>

          {/* Activity Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '14px',
              lineHeight: '1.5',
              color: 'var(--gray-700)',
              marginBottom: '4px'
            }}>
              {activity.description}
            </div>
            <div style={{
              fontSize: '12px',
              color: 'var(--gray-500)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              {getActivityIcon(activity.action_type)}
              <span>{getTimeAgo(activity.created_at)}</span>
              {activity.entity_type === 'lead' && activity.entity_id && (
                <>
                  <span>•</span>
                  <Link
                    to={`/leads/${activity.entity_id}`}
                    style={{
                      color: 'var(--primary)',
                      textDecoration: 'none',
                      fontSize: '12px'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    View Lead
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default ActivityFeed
