import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getCRMDashboardData, getOutreachStatsByPerson, cachePeek } from '../lib/crm-api'
import { useApp } from '../App'
import { istToday, istAddDays, fmtDate } from '../lib/dateUtils'
import { TrendingUp, AlertCircle, Calendar, Activity, Clock, FlaskConical } from 'lucide-react'

const DAILY_GOAL = 10

const PIPELINE_SEGMENTS = [
  { key: 'new_lead',             label: 'New',       color: '#a78bfa' },
  { key: 'cold_outreach',        label: 'Cold',      color: '#60a5fa' },
  { key: 'responded',            label: 'Responded', color: '#06b6d4' },
  { key: 'warm_lead',            label: 'Warm',      color: '#fbbf24' },
  { key: 'active_conversation',  label: 'Active',    color: '#f97316' },
  { key: 'client',               label: 'Clients',   color: '#22c55e' },
]

function daysSince(dateStr) {
  if (!dateStr) return null
  return Math.ceil((Date.now() - new Date(dateStr)) / (1000 * 60 * 60 * 24))
}

// Mirrors the helper in Layout.jsx.
const BOOTSTRAP_ADMIN_EMAIL = 'dev@pocket-fund.com'
function isAdminUser(person) {
  if (!person) return false
  return Boolean(person.is_admin) || person.email === BOOTSTRAP_ADMIN_EMAIL
}

function Dashboard() {
  const { currentPerson, people } = useApp()
  const isAdmin = isAdminUser(currentPerson)
  // Non-admins only see their own card on the per-person grids; admins
  // see the full team. Mirrors the data isolation we already enforce on
  // the underlying queries via RLS.
  const visiblePeople = useMemo(
    () => isAdmin
      ? (people || [])
      : (currentPerson ? [currentPerson] : []),
    [isAdmin, people, currentPerson]
  )
  const cacheKey = 'dashboard:' + (currentPerson?.id ?? 'all')
  const [data, setData] = useState(() => cachePeek(cacheKey) || null)
  const [outreachRows, setOutreachRows] = useState([])
  const [loading, setLoading] = useState(() => !cachePeek(cacheKey))

  useEffect(() => {
    loadData()
  }, [currentPerson?.id])

  async function loadData() {
    if (!currentPerson?.id) return
    try {
      const [dashboardData, rows] = await Promise.all([
        getCRMDashboardData(currentPerson.id),
        getOutreachStatsByPerson(7).catch(() => [])
      ])
      setData(dashboardData)
      setOutreachRows(rows)
    } catch (error) {
      console.error('Failed to load dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const today = istToday()
  const weekStart = istAddDays(today, -6)

  // Compute per-person stats from raw outreach rows
  const personStats = useMemo(() => {
    const map = new Map()
    for (const r of outreachRows) {
      if (!map.has(r.logged_by)) {
        map.set(r.logged_by, { todayCount: 0, weekCount: 0, weekReplies: 0 })
      }
      const s = map.get(r.logged_by)
      s.weekCount += 1
      if (r.status === 'replied') s.weekReplies += 1
      if (r.outreach_date === today) s.todayCount += 1
    }
    return map
  }, [outreachRows, today])

  // Team totals for this week
  const teamWeek = useMemo(() => {
    let total = 0, replies = 0
    for (const s of personStats.values()) {
      total += s.weekCount
      replies += s.weekReplies
    }
    return { total, replies, replyRate: total > 0 ? Math.round((replies / total) * 100) : 0 }
  }, [personStats])

  if (loading && !data) {
    return (
      <div>
        <div className="page-header"><h1>Dashboard</h1></div>
        <div className="loading">Loading dashboard...</div>
      </div>
    )
  }

  if (!data) return <div>Error loading dashboard</div>

  const { pipelineStats, staleLeads, followUps, needsSamples, activeStale, settings } = data
  const hasAlerts = activeStale.length || staleLeads.length || followUps.length || needsSamples.length

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>Dashboard</h1>
        <Link to="/outreach" className="btn btn-primary">Log Outreach</Link>
      </div>

      {/* Today's Outreach */}
      <div className="card dashboard-card">
        <div className="dashboard-card-header">
          <h2><Activity size={20} /> Today's Outreach</h2>
          <span className="dashboard-date-label">{fmtDate(today)}</span>
        </div>
        <div className="today-outreach-grid">
          {visiblePeople.map(person => {
            const stats = personStats.get(person.id) || { todayCount: 0, weekCount: 0, weekReplies: 0 }
            const pct = Math.min(100, (stats.todayCount / DAILY_GOAL) * 100)
            const hit = stats.todayCount >= DAILY_GOAL
            const isMe = person.id === currentPerson?.id
            return (
              <div key={person.id} className={`person-outreach-card${isMe ? ' person-outreach-card-me' : ''}`}>
                <div className="person-outreach-name">
                  {person.name}
                  {isMe && <span className="person-outreach-you">you</span>}
                </div>
                <div className="person-outreach-count-row">
                  <span className={`person-outreach-count${hit ? ' person-outreach-count-hit' : ''}`}>
                    {stats.todayCount}
                  </span>
                  <span className="person-outreach-goal">/ {DAILY_GOAL}</span>
                </div>
                <div className="person-outreach-bar-track">
                  <div
                    className={`person-outreach-bar-fill${hit ? ' person-outreach-bar-hit' : ''}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* This Week Summary */}
      <div className="card dashboard-card">
        <div className="dashboard-card-header">
          <h2><Calendar size={20} /> This Week</h2>
          <span className="dashboard-date-label">{fmtDate(weekStart)} – {fmtDate(today)}</span>
        </div>
        <div className="week-summary-grid">
          <div className="week-stat-block">
            <div className="week-stat-value">{teamWeek.total}</div>
            <div className="week-stat-label">Total Outreach</div>
          </div>
          <div className="week-stat-block">
            <div className="week-stat-value">{teamWeek.replies}</div>
            <div className="week-stat-label">Replies</div>
          </div>
          <div className="week-stat-block">
            <div className={`week-stat-value${teamWeek.replyRate >= 10 ? ' week-stat-good' : ''}`}>
              {teamWeek.replyRate}%
            </div>
            <div className="week-stat-label">Reply Rate</div>
          </div>
          {/* "Avg / Person" only makes sense when looking at the team —
              hide it for non-admins who only see their own row. */}
          {isAdmin && (
            <div className="week-stat-block">
              <div className="week-stat-value">
                {visiblePeople.length > 0 ? Math.round(teamWeek.total / visiblePeople.length) : 0}
              </div>
              <div className="week-stat-label">Avg / Person</div>
            </div>
          )}
        </div>

        {/* Per-person weekly breakdown — only shown for admins; non-admins
            see their own numbers in the summary tiles above. */}
        {isAdmin && visiblePeople.length > 0 && (
          <div className="week-person-table">
            <div className="week-person-header">
              <span>Person</span>
              <span>Outreach</span>
              <span>Replies</span>
              <span>Rate</span>
            </div>
            {visiblePeople.map(person => {
              const s = personStats.get(person.id) || { weekCount: 0, weekReplies: 0 }
              const rate = s.weekCount > 0 ? Math.round((s.weekReplies / s.weekCount) * 100) : 0
              return (
                <div key={person.id} className="week-person-row">
                  <span className="week-person-name">
                    {person.name}
                    {person.id === currentPerson?.id && <span className="person-outreach-you">you</span>}
                  </span>
                  <span>{s.weekCount}</span>
                  <span>{s.weekReplies}</span>
                  <span className={rate >= 10 ? 'week-stat-good' : ''}>{rate}%</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pipeline Overview */}
      <div className="card dashboard-card">
        <div className="dashboard-card-header">
          <h2><TrendingUp size={20} /> Pipeline</h2>
          <Link to="/pipeline" className="dashboard-link">View all →</Link>
        </div>
        <PipelineBar stats={pipelineStats} />
      </div>

      {/* Alerts — secondary, at bottom */}
      {hasAlerts ? (
        <div className="card dashboard-card dashboard-alerts">
          <h2><AlertCircle size={20} color="#ef4444" /> Action Required</h2>

          {activeStale.length > 0 && (
            <AlertSection
              tone="urgent"
              title={`${activeStale.length} Active Conversation${activeStale.length === 1 ? '' : 's'} Gone Cold`}
              leads={activeStale}
              showDays
            />
          )}

          {staleLeads.length > 0 && (
            <AlertSection
              tone="warn"
              title={`${staleLeads.length} Stale Lead${staleLeads.length === 1 ? '' : 's'}`}
              leads={staleLeads}
              limit={5}
              showDays
              showStage
            />
          )}

          {followUps.length > 0 && (
            <AlertSection
              tone="info"
              icon={<Calendar size={16} />}
              title={`${followUps.length} Follow-up${followUps.length === 1 ? '' : 's'} Due Today`}
              leads={followUps}
            />
          )}

          {needsSamples.length > 0 && (
            <AlertSection
              tone="info"
              icon={<FlaskConical size={16} />}
              title={`${needsSamples.length} Lead${needsSamples.length === 1 ? '' : 's'} Need Sample Deals`}
              leads={needsSamples}
            />
          )}
        </div>
      ) : (
        <div className="card dashboard-card dashboard-ok">
          <h2>Pipeline is Healthy</h2>
          <p>No action required. All leads are up to date.</p>
        </div>
      )}
    </div>
  )
}

function PipelineBar({ stats }) {
  const total = useMemo(
    () => PIPELINE_SEGMENTS.reduce((sum, s) => sum + (stats[s.key] || 0), 0),
    [stats]
  )
  if (total === 0) {
    return <div className="pipeline-empty">No leads in pipeline yet</div>
  }
  return (
    <>
      <div className="pipeline-bar">
        {PIPELINE_SEGMENTS.map(seg => {
          const count = stats[seg.key] || 0
          const pct = total > 0 ? (count / total) * 100 : 0
          if (pct === 0) return null
          return (
            <div
              key={seg.key}
              className="pipeline-segment"
              style={{ width: `${pct}%`, background: seg.color }}
              title={`${seg.label}: ${count} (${Math.round(pct)}%)`}
            >
              {pct >= 12 && <span className="pipeline-segment-label">{seg.label}: {count}</span>}
              {pct < 12 && pct >= 5 && <span className="pipeline-segment-label">{count}</span>}
            </div>
          )
        })}
      </div>
      <div className="pipeline-legend">
        {PIPELINE_SEGMENTS.map(seg => (
          <div key={seg.key} className="pipeline-legend-item">
            <span className="pipeline-legend-dot" style={{ background: seg.color }} />
            <span className="pipeline-legend-label">{seg.label}</span>
            <span className="pipeline-legend-count">{stats[seg.key] || 0}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function AlertSection({ tone, title, icon, leads, limit, showDays, showStage }) {
  const shown = limit ? leads.slice(0, limit) : leads
  const overflow = limit && leads.length > limit ? leads.length - limit : 0
  return (
    <div className={`alert-section alert-section-${tone}`}>
      <h3 className="alert-section-title">
        {icon && <span className="alert-section-icon">{icon}</span>}
        {title}
      </h3>
      <ul className="alert-lead-list">
        {shown.map(lead => (
          <li key={lead.id} className="alert-lead-row">
            <Link to={`/leads/${lead.id}`} className="alert-lead-name">{lead.name}</Link>
            {lead.firm_name && <span className="alert-lead-firm">{lead.firm_name}</span>}
            {showStage && lead.stage && (
              <span className="alert-lead-stage">{lead.stage.replace(/_/g, ' ')}</span>
            )}
            {showDays && lead.last_activity_date && (
              <span className="alert-lead-days">
                <Clock size={12} />
                {daysSince(lead.last_activity_date)}d
              </span>
            )}
          </li>
        ))}
      </ul>
      {overflow > 0 && <div className="alert-overflow">… and {overflow} more</div>}
    </div>
  )
}

export default Dashboard
