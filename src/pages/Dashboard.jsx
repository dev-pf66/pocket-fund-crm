import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getCRMDashboardData, getAssignedLeads } from '../lib/crm-api'
import { useApp } from '../App'
import { TrendingUp, AlertCircle, Calendar, FileText, Phone, Activity, User, Clock, FlaskConical } from 'lucide-react'
import ActivityFeed from '../components/ActivityFeed'

const PIPELINE_SEGMENTS = [
  { key: 'new_lead',             label: 'New',     color: '#a78bfa', countKey: 'new_lead',            pctKey: 'new_pct' },
  { key: 'cold_outreach',        label: 'Cold',    color: '#60a5fa', countKey: 'cold_outreach',       pctKey: 'cold_pct' },
  { key: 'warm_lead',            label: 'Warm',    color: '#fbbf24', countKey: 'warm_lead',           pctKey: 'warm_pct' },
  { key: 'active_conversation',  label: 'Active',  color: '#f97316', countKey: 'active_conversation', pctKey: 'active_pct' },
  { key: 'client',               label: 'Clients', color: '#22c55e', countKey: 'client',              pctKey: 'client_pct' },
]

function daysSince(dateStr) {
  if (!dateStr) return null
  return Math.ceil((Date.now() - new Date(dateStr)) / (1000 * 60 * 60 * 24))
}

function Dashboard() {
  const { currentPerson } = useApp()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [myLeads, setMyLeads] = useState([])

  useEffect(() => {
    loadData()
  }, [currentPerson?.id])

  async function loadData() {
    setLoading(true)
    try {
      const promises = [getCRMDashboardData()]
      if (currentPerson?.id) {
        promises.push(getAssignedLeads(currentPerson.id).catch(() => []))
      }
      const [dashboardData, assigned] = await Promise.all(promises)
      setData(dashboardData)
      setMyLeads(assigned || [])
    } catch (error) {
      console.error('Failed to load CRM dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1>Sales CRM Dashboard</h1></div>
        <div className="loading">Loading dashboard...</div>
      </div>
    )
  }

  if (!data) return <div>Error loading dashboard</div>

  const { pipelineStats, staleLeads, followUps, needsSamples, activeStale, weeklyStats, settings } = data
  const hasAlerts = activeStale.length || staleLeads.length || followUps.length || needsSamples.length

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>Sales CRM Dashboard</h1>
        <Link to="/pipeline" className="btn btn-primary">View Pipeline</Link>
      </div>

      {/* Pipeline Overview */}
      <div className="card dashboard-card">
        <h2><TrendingUp size={20} /> Pipeline Overview</h2>
        <PipelineBar stats={pipelineStats} />
      </div>

      {/* Alerts */}
      {hasAlerts ? (
        <div className="card dashboard-card dashboard-alerts">
          <h2><AlertCircle size={20} color="#ef4444" /> Action Required Today</h2>

          {activeStale.length > 0 && (
            <AlertSection
              tone="urgent"
              title={`URGENT — ${activeStale.length} Active Conversation${activeStale.length === 1 ? '' : 's'} Gone Cold`}
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
          <h2>✅ Pipeline is Healthy</h2>
          <p>No action required. All leads are up to date.</p>
        </div>
      )}

      {/* Weekly Performance */}
      <div className="card dashboard-card">
        <h2><Calendar size={20} /> This Week</h2>
        <div className="stat-grid">
          <StatCard
            icon={<Phone size={16} />}
            label="Discovery Calls"
            value={weeklyStats.discovery_calls}
            target={settings.weekly_discovery_call_target}
            goodWhen={weeklyStats.discovery_calls >= settings.weekly_discovery_call_target}
          />
          <StatCard icon={<FileText size={16} />} label="Proposals Sent" value={weeklyStats.proposals_sent} />
          <StatCard icon={<TrendingUp size={16} />} label="New Leads" value={weeklyStats.new_leads} />
          <StatCard label="Clients Closed" value={weeklyStats.closed_clients} tone="success" />
        </div>
      </div>

      {/* My Leads + Team Activity */}
      <div className="dashboard-split">
        <div className="card dashboard-card">
          <h2><User size={20} /> My Assigned Leads</h2>
          {myLeads.length === 0 ? (
            <div className="empty-state">
              <User size={48} />
              <div>No leads assigned to you yet</div>
            </div>
          ) : (
            <>
              <div className="my-leads-count">
                {myLeads.length}
                <span className="my-leads-unit">lead{myLeads.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="my-leads-scroll">
                {myLeads.map(lead => (
                  <Link key={lead.id} to={`/leads/${lead.id}`} className="my-lead-row">
                    <div className="my-lead-name">{lead.name}</div>
                    {lead.firm_name && <div className="my-lead-firm">{lead.firm_name}</div>}
                    <div className="my-lead-meta">
                      {lead.stage.replace(/_/g, ' ')} • Assigned {new Date(lead.assigned_date).toLocaleDateString()}
                    </div>
                  </Link>
                ))}
              </div>
              <Link to="/pipeline" className="dashboard-link">View All in Pipeline →</Link>
            </>
          )}
        </div>

        <div className="card dashboard-card">
          <h2><Activity size={20} /> Team Activity</h2>
          <div className="activity-scroll">
            <ActivityFeed limit={10} />
          </div>
        </div>
      </div>
    </div>
  )
}

function PipelineBar({ stats }) {
  const total = useMemo(
    () => PIPELINE_SEGMENTS.reduce((sum, s) => sum + (stats[s.countKey] || 0), 0),
    [stats]
  )
  if (total === 0) {
    return <div className="pipeline-empty">No leads in pipeline yet</div>
  }
  return (
    <>
      <div className="pipeline-bar">
        {PIPELINE_SEGMENTS.map(seg => {
          const pct = stats[seg.pctKey] || 0
          const count = stats[seg.countKey] || 0
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
            <span className="pipeline-legend-count">{stats[seg.countKey] || 0}</span>
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

function StatCard({ icon, label, value, target, goodWhen, tone }) {
  return (
    <div className={`stat-card ${tone ? `stat-card-${tone}` : ''}`}>
      <div className="stat-label">
        {icon && <span className="stat-icon">{icon}</span>}
        {label}
      </div>
      <div className={`stat-value ${target != null ? (goodWhen ? 'stat-value-good' : 'stat-value-bad') : ''}`}>
        {value}
      </div>
      {target != null && <div className="stat-target">Target: {target}</div>}
    </div>
  )
}

export default Dashboard
