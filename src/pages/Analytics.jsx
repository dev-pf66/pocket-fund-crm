import { useState, useEffect } from 'react'
import { getAnalytics } from '../lib/crm-api'
import { TrendingUp, Clock, Target, Award } from 'lucide-react'

function Analytics() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAnalytics()
  }, [])

  async function loadAnalytics() {
    setLoading(true)
    try {
      const analytics = await getAnalytics()
      setData(analytics)
    } catch (error) {
      console.error('Failed to load analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="loading">Loading analytics...</div>
  }

  if (!data) {
    return <div>Failed to load analytics</div>
  }

  const { conversion, velocity, sources, weekly } = data

  return (
    <div>
      <div className="page-header">
        <h1>Analytics & Insights</h1>
      </div>

      {/* Conversion Funnel */}
      <div className="card">
        <h2><TrendingUp size={20} /> Conversion Funnel</h2>
        <p style={{ color: 'var(--gray-600)', marginBottom: '24px' }}>
          How leads move through your pipeline
        </p>

        <div className="funnel-container">
          <div className="funnel-stage" style={{ '--width': '100%', '--color': '#60a5fa' }}>
            <div className="funnel-bar">
              <div className="funnel-label">
                <span className="funnel-stage-name">Cold Outreach</span>
                <span className="funnel-count">{conversion.cold_outreach}</span>
              </div>
            </div>
          </div>

          <div className="funnel-arrow">
            <div className="conversion-rate">
              {conversion.cold_to_warm_rate}% convert
            </div>
          </div>

          <div className="funnel-stage" style={{ '--width': `${(conversion.warm_lead / conversion.cold_outreach) * 100}%`, '--color': '#fbbf24' }}>
            <div className="funnel-bar">
              <div className="funnel-label">
                <span className="funnel-stage-name">Warm Leads</span>
                <span className="funnel-count">{conversion.warm_lead}</span>
              </div>
            </div>
          </div>

          <div className="funnel-arrow">
            <div className="conversion-rate">
              {conversion.warm_to_active_rate}% convert
            </div>
          </div>

          <div className="funnel-stage" style={{ '--width': `${(conversion.active_conversation / conversion.cold_outreach) * 100}%`, '--color': '#f97316' }}>
            <div className="funnel-bar">
              <div className="funnel-label">
                <span className="funnel-stage-name">Active Conversations</span>
                <span className="funnel-count">{conversion.active_conversation}</span>
              </div>
            </div>
          </div>

          <div className="funnel-arrow">
            <div className="conversion-rate">
              {conversion.active_to_client_rate}% close
            </div>
          </div>

          <div className="funnel-stage" style={{ '--width': `${(conversion.client / conversion.cold_outreach) * 100}%`, '--color': '#22c55e' }}>
            <div className="funnel-bar">
              <div className="funnel-label">
                <span className="funnel-stage-name">Clients</span>
                <span className="funnel-count">{conversion.client}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="overall-conversion">
          <strong>Overall Conversion:</strong> {conversion.overall_rate}% of cold outreach → clients
        </div>
      </div>

      {/* Pipeline Velocity */}
      <div className="analytics-grid">
        <div className="card">
          <h2><Clock size={20} /> Pipeline Velocity</h2>
          <p style={{ color: 'var(--gray-600)', marginBottom: '20px' }}>
            Average days in each stage
          </p>

          <div className="velocity-stats">
            <div className="velocity-item">
              <div className="velocity-stage">Cold Outreach</div>
              <div className="velocity-days">{velocity.cold_outreach} days</div>
            </div>
            <div className="velocity-item">
              <div className="velocity-stage">Warm Lead</div>
              <div className="velocity-days">{velocity.warm_lead} days</div>
            </div>
            <div className="velocity-item">
              <div className="velocity-stage">Active Conversation</div>
              <div className="velocity-days">{velocity.active_conversation} days</div>
            </div>
            <div className="velocity-item" style={{ borderBottom: 'none' }}>
              <div className="velocity-stage">Total Time to Close</div>
              <div className="velocity-days" style={{ fontSize: '24px', color: 'var(--primary)' }}>
                {velocity.total} days
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h2><Target size={20} /> Lead Sources ROI</h2>
          <p style={{ color: 'var(--gray-600)', marginBottom: '20px' }}>
            Which sources convert best
          </p>

          <div className="sources-list">
            {sources.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-500)' }}>
                No lead source data yet
              </div>
            )}

            {sources.map(source => (
              <div key={source.source} className="source-item">
                <div className="source-name">{source.source || 'Unknown'}</div>
                <div className="source-stats">
                  <div className="source-count">{source.total} leads</div>
                  <div className="source-conversion">{source.conversion_rate}% → clients</div>
                </div>
                <div className="source-bar">
                  <div
                    className="source-bar-fill"
                    style={{ width: `${source.conversion_rate}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Weekly Trends */}
      <div className="card">
        <h2><Award size={20} /> Last 4 Weeks Performance</h2>
        <div className="weekly-grid">
          {weekly.map((week, idx) => (
            <div key={idx} className="week-card">
              <div className="week-label">Week {4 - idx}</div>
              <div className="week-stats">
                <div className="week-stat">
                  <div className="week-stat-value">{week.new_leads}</div>
                  <div className="week-stat-label">New Leads</div>
                </div>
                <div className="week-stat">
                  <div className="week-stat-value">{week.moved_to_active}</div>
                  <div className="week-stat-label">→ Active</div>
                </div>
                <div className="week-stat">
                  <div className="week-stat-value" style={{ color: '#22c55e' }}>{week.closed}</div>
                  <div className="week-stat-label">Closed</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Analytics
