import { useState, useEffect } from 'react'
import { getAnalytics, getDailyOutreachStats } from '../lib/crm-api'
import { TrendingUp, Clock, Target, Award, Send } from 'lucide-react'

function Analytics() {
  const [data, setData] = useState(null)
  const [outreachStats, setOutreachStats] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAnalytics()
  }, [])

  async function loadAnalytics() {
    setLoading(true)
    try {
      const analytics = await getAnalytics()
      setData(analytics)

      // Try to load outreach stats, but don't fail if table doesn't exist yet
      try {
        const outreach = await getDailyOutreachStats(7)
        setOutreachStats(outreach)
      } catch (outreachError) {
        console.log('Outreach stats not available yet (table may not exist)')
        setOutreachStats([])
      }
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

      {/* Daily Outreach Activity */}
      <div className="card">
        <h2><Send size={20} /> Daily Outreach Activity (Last 7 Days)</h2>
        <p style={{ color: 'var(--gray-600)', marginBottom: '20px' }}>
          Track daily outreach progress toward 10/day goal
        </p>

        {outreachStats.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--gray-500)' }}>
            No outreach logged yet. Start tracking in the Outreach Tracker! 🚀
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--gray-200)', textAlign: 'left' }}>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Date</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Total</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Emails</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>LinkedIn</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Calls</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Replies</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Goal</th>
                </tr>
              </thead>
              <tbody>
                {outreachStats.map((day, idx) => {
                  const total = Number(day.total_outreaches)
                  const goalMet = day.goal_met
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                      <td style={{ padding: '12px 8px', fontSize: '14px', fontWeight: '500' }}>
                        {new Date(day.outreach_date).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '18px', fontWeight: 'bold', color: goalMet ? 'var(--success)' : 'var(--primary)' }}>
                        {total}
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '14px', color: 'var(--gray-600)' }}>
                        {day.cold_emails}
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '14px', color: 'var(--gray-600)' }}>
                        {day.linkedin_messages}
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '14px', color: 'var(--gray-600)' }}>
                        {day.phone_calls}
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '14px', color: 'var(--success)', fontWeight: '600' }}>
                        {day.replied_count}
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        {goalMet ? (
                          <span style={{
                            background: 'var(--success)',
                            color: 'white',
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '13px',
                            fontWeight: '600'
                          }}>
                            ✓ Met
                          </span>
                        ) : (
                          <span style={{
                            background: 'var(--gray-200)',
                            color: 'var(--gray-600)',
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '13px',
                            fontWeight: '600'
                          }}>
                            {total}/10
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Summary Stats */}
            <div style={{
              marginTop: '24px',
              padding: '16px',
              background: 'var(--gray-50)',
              borderRadius: '8px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '16px'
            }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--gray-600)', marginBottom: '4px' }}>Total Outreaches</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--primary)' }}>
                  {outreachStats.reduce((sum, day) => sum + Number(day.total_outreaches), 0)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--gray-600)', marginBottom: '4px' }}>Daily Average</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--primary)' }}>
                  {Math.round(outreachStats.reduce((sum, day) => sum + Number(day.total_outreaches), 0) / outreachStats.length)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--gray-600)', marginBottom: '4px' }}>Days Hit Goal</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--success)' }}>
                  {outreachStats.filter(d => d.goal_met).length}/{outreachStats.length}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--gray-600)', marginBottom: '4px' }}>Reply Rate</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--success)' }}>
                  {Math.round((outreachStats.reduce((sum, day) => sum + Number(day.replied_count), 0) /
                    outreachStats.reduce((sum, day) => sum + Number(day.total_outreaches), 0)) * 100) || 0}%
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Analytics
