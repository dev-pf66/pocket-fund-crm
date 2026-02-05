import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getCRMDashboardData } from '../lib/crm-api'
import { TrendingUp, AlertCircle, Calendar, FileText, Phone } from 'lucide-react'

function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const dashboardData = await getCRMDashboardData()
      setData(dashboardData)
    } catch (error) {
      console.error('Failed to load CRM dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1>Sales CRM Dashboard</h1>
        </div>
        <div className="loading">Loading dashboard...</div>
      </div>
    )
  }

  if (!data) {
    return <div>Error loading dashboard</div>
  }

  const { pipelineStats, staleLeads, followUps, needsSamples, activeStale, weeklyStats, settings } = data

  return (
    <div>
      <div className="page-header">
        <h1>Sales CRM Dashboard</h1>
        <Link to="/crm/leads" className="btn btn-primary">
          View Pipeline
        </Link>
      </div>

      {/* Pipeline Health */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2><TrendingUp size={20} /> Pipeline Overview</h2>
        <div className="pipeline-bar" style={{
          display: 'flex',
          height: '60px',
          borderRadius: '8px',
          overflow: 'hidden',
          marginTop: '1rem'
        }}>
          <div style={{
            width: `${pipelineStats.cold_pct}%`,
            background: '#60a5fa',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 'bold'
          }}>
            Cold: {pipelineStats.cold_outreach}
          </div>
          <div style={{
            width: `${pipelineStats.warm_pct}%`,
            background: '#fbbf24',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 'bold'
          }}>
            Warm: {pipelineStats.warm_lead}
          </div>
          <div style={{
            width: `${pipelineStats.active_pct}%`,
            background: '#f97316',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 'bold'
          }}>
            Active: {pipelineStats.active_conversation}
          </div>
          <div style={{
            width: `${pipelineStats.client_pct}%`,
            background: '#22c55e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 'bold'
          }}>
            Clients: {pipelineStats.client}
          </div>
        </div>
      </div>

      {/* Red Alerts */}
      {(activeStale.length > 0 || staleLeads.length > 0 || followUps.length > 0 || needsSamples.length > 0) && (
        <div className="card" style={{ marginBottom: '1.5rem', borderColor: '#ef4444' }}>
          <h2><AlertCircle size={20} color="#ef4444" /> 🔴 Action Required Today</h2>

          {activeStale.length > 0 && (
            <div style={{
              background: '#fef2f2',
              padding: '1rem',
              borderRadius: '8px',
              marginTop: '1rem',
              borderLeft: '4px solid #ef4444'
            }}>
              <h3 style={{ color: '#dc2626', marginBottom: '0.5rem' }}>
                ⚠️ URGENT: {activeStale.length} Active Conversations Gone Cold!
              </h3>
              {activeStale.map(lead => (
                <div key={lead.id} style={{ padding: '0.5rem 0' }}>
                  <Link to={`/crm/leads/${lead.id}`} style={{ fontWeight: 'bold', color: '#dc2626' }}>
                    {lead.name}
                  </Link>
                  {lead.firm_name && <span> • {lead.firm_name}</span>}
                  <span style={{ color: '#ef4444', marginLeft: '0.5rem' }}>
                    ({Math.ceil((Date.now() - new Date(lead.last_activity_date)) / (1000 * 60 * 60 * 24))} days)
                  </span>
                </div>
              ))}
            </div>
          )}

          {staleLeads.length > 0 && (
            <div style={{ padding: '1rem 0', borderTop: '1px solid #fee2e2' }}>
              <h3 style={{ color: '#dc2626', marginBottom: '0.5rem' }}>
                🔴 {staleLeads.length} Stale Leads
              </h3>
              {staleLeads.slice(0, 5).map(lead => (
                <div key={lead.id} style={{ padding: '0.25rem 0' }}>
                  <Link to={`/crm/leads/${lead.id}`}>
                    {lead.name}
                  </Link>
                  {lead.firm_name && <span> • {lead.firm_name}</span>}
                  <span style={{ color: '#9ca3af', marginLeft: '0.5rem' }}>
                    ({lead.stage.replace('_', ' ')}, {Math.ceil((Date.now() - new Date(lead.last_activity_date)) / (1000 * 60 * 60 * 24))} days)
                  </span>
                </div>
              ))}
              {staleLeads.length > 5 && (
                <div style={{ marginTop: '0.5rem', color: '#9ca3af' }}>
                  ... and {staleLeads.length - 5} more
                </div>
              )}
            </div>
          )}

          {followUps.length > 0 && (
            <div style={{ padding: '1rem 0', borderTop: '1px solid #fee2e2' }}>
              <h3 style={{ color: '#f97316', marginBottom: '0.5rem' }}>
                📅 {followUps.length} Follow-ups Due Today
              </h3>
              {followUps.map(lead => (
                <div key={lead.id} style={{ padding: '0.25rem 0' }}>
                  <Link to={`/crm/leads/${lead.id}`}>
                    {lead.name}
                  </Link>
                  {lead.firm_name && <span> • {lead.firm_name}</span>}
                </div>
              ))}
            </div>
          )}

          {needsSamples.length > 0 && (
            <div style={{ padding: '1rem 0', borderTop: '1px solid #fee2e2' }}>
              <h3 style={{ color: '#f97316', marginBottom: '0.5rem' }}>
                📋 {needsSamples.length} Leads Need Sample Deals
              </h3>
              {needsSamples.map(lead => (
                <div key={lead.id} style={{ padding: '0.25rem 0' }}>
                  <Link to={`/crm/leads/${lead.id}`}>
                    {lead.name}
                  </Link>
                  {lead.firm_name && <span> • {lead.firm_name}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(activeStale.length === 0 && staleLeads.length === 0 && followUps.length === 0 && needsSamples.length === 0) && (
        <div className="card" style={{ marginBottom: '1.5rem', background: '#f0fdf4', borderColor: '#22c55e' }}>
          <h2 style={{ color: '#16a34a' }}>✅ HEARTBEAT_OK - Pipeline is Healthy!</h2>
          <p style={{ color: '#16a34a' }}>No action required. All leads are up to date.</p>
        </div>
      )}

      {/* Weekly Performance */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2><Calendar size={20} /> This Week</h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '1rem',
          marginTop: '1rem'
        }}>
          <div className="stat-card">
            <div style={{ fontSize: '0.875rem', color: '#9ca3af', marginBottom: '0.25rem' }}>
              <Phone size={16} style={{ display: 'inline', marginRight: '0.25rem' }} />
              Discovery Calls
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: weeklyStats.discovery_calls >= settings.weekly_discovery_call_target ? '#22c55e' : '#ef4444' }}>
              {weeklyStats.discovery_calls}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
              Target: {settings.weekly_discovery_call_target}
            </div>
          </div>

          <div className="stat-card">
            <div style={{ fontSize: '0.875rem', color: '#9ca3af', marginBottom: '0.25rem' }}>
              <FileText size={16} style={{ display: 'inline', marginRight: '0.25rem' }} />
              Proposals Sent
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {weeklyStats.proposals_sent}
            </div>
          </div>

          <div className="stat-card">
            <div style={{ fontSize: '0.875rem', color: '#9ca3af', marginBottom: '0.25rem' }}>
              ➕ New Leads
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {weeklyStats.new_leads}
            </div>
          </div>

          <div className="stat-card" style={{ background: '#f0fdf4', borderColor: '#22c55e' }}>
            <div style={{ fontSize: '0.875rem', color: '#16a34a', marginBottom: '0.25rem' }}>
              🎉 Clients Closed
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#16a34a' }}>
              {weeklyStats.closed_clients}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
