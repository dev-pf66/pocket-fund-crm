import { useState, useEffect } from 'react'
import { getOutreachLog, logOutreach, updateOutreach, deleteOutreach, getTodaysOutreachCount, getDailyOutreachStats, getOutreachStreak, getLeads } from '../lib/crm-api'
import { useApp } from '../App'
import { Target, Mail, Linkedin, Phone, MessageSquare, Trash2, CheckCircle, XCircle, Clock, TrendingUp } from 'lucide-react'

function OutreachTracker() {
  const { currentPerson } = useApp()
  const [outreaches, setOutreaches] = useState([])
  const [todayCount, setTodayCount] = useState(0)
  const [streak, setStreak] = useState(0)
  const [weeklyStats, setWeeklyStats] = useState([])
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const [newOutreach, setNewOutreach] = useState({
    lead_id: null,
    lead_name: '',
    firm_name: '',
    outreach_type: 'cold_email',
    status: 'sent',
    notes: ''
  })

  const [filter, setFilter] = useState({
    view: 'today', // 'today', 'week', 'all'
    type: 'all',
    status: 'all'
  })

  useEffect(() => {
    loadData()
  }, [filter])

  async function loadData() {
    setLoading(true)
    try {
      const [count, streakData, stats, leadsData] = await Promise.all([
        getTodaysOutreachCount(),
        getOutreachStreak(),
        getDailyOutreachStats(7),
        getLeads({ stage: 'cold_outreach' })
      ])

      setTodayCount(count)
      setStreak(streakData)
      setWeeklyStats(stats)
      setLeads(leadsData)

      // Get outreaches based on filter
      const filters = {}
      if (filter.view === 'today') {
        filters.outreach_date = new Date().toISOString().split('T')[0]
      } else if (filter.view === 'week') {
        filters.days_back = 7
      } else {
        filters.days_back = 30
      }

      if (filter.type !== 'all') {
        filters.outreach_type = filter.type
      }

      if (filter.status !== 'all') {
        filters.status = filter.status
      }

      const outreachData = await getOutreachLog(filters)
      setOutreaches(outreachData)
    } catch (error) {
      console.error('Failed to load outreach data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddOutreach() {
    if (!newOutreach.lead_name && !newOutreach.lead_id) {
      alert('Please enter a lead name or select from dropdown')
      return
    }

    try {
      await logOutreach(newOutreach, currentPerson?.id)
      setNewOutreach({
        lead_id: null,
        lead_name: '',
        firm_name: '',
        outreach_type: 'cold_email',
        status: 'sent',
        notes: ''
      })
      setShowForm(false)
      await loadData()
    } catch (error) {
      console.error('Failed to log outreach:', error)
      alert('Failed to log outreach')
    }
  }

  async function handleUpdateStatus(id, newStatus) {
    try {
      await updateOutreach(id, { status: newStatus })
      await loadData()
    } catch (error) {
      console.error('Failed to update status:', error)
      alert('Failed to update status')
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this outreach entry?')) return

    try {
      await deleteOutreach(id)
      await loadData()
    } catch (error) {
      console.error('Failed to delete outreach:', error)
      alert('Failed to delete outreach')
    }
  }

  function handleLeadSelect(e) {
    const leadId = parseInt(e.target.value)
    if (!leadId) {
      setNewOutreach({ ...newOutreach, lead_id: null, lead_name: '', firm_name: '' })
      return
    }

    const lead = leads.find(l => l.id === leadId)
    if (lead) {
      setNewOutreach({
        ...newOutreach,
        lead_id: lead.id,
        lead_name: lead.name,
        firm_name: lead.firm_name || ''
      })
    }
  }

  const outreachTypeIcons = {
    cold_email: <Mail size={16} />,
    linkedin_message: <Linkedin size={16} />,
    phone_call: <Phone size={16} />,
    other: <MessageSquare size={16} />
  }

  const statusIcons = {
    sent: <Clock size={14} />,
    replied: <CheckCircle size={14} />,
    no_response: <XCircle size={14} />,
    bounced: <XCircle size={14} />
  }

  const goalPercentage = Math.min((todayCount / 10) * 100, 100)
  const goalMet = todayCount >= 10

  if (loading && outreaches.length === 0) {
    return <div className="loading">Loading outreach tracker...</div>
  }

  return (
    <div>
      <div className="page-header">
        <h1>Outreach Tracker</h1>
        <button
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : '+ Log Outreach'}
        </button>
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {/* Today's Progress */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <Target size={20} color={goalMet ? 'var(--success)' : 'var(--primary)'} />
            <h3 style={{ margin: 0, fontSize: '16px' }}>Today's Progress</h3>
          </div>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: goalMet ? 'var(--success)' : 'var(--primary)' }}>
            {todayCount}
            <span style={{ fontSize: '18px', color: 'var(--gray-400)' }}>/10</span>
          </div>
          <div style={{
            width: '100%',
            height: '8px',
            background: 'var(--gray-200)',
            borderRadius: '4px',
            overflow: 'hidden',
            marginTop: '12px'
          }}>
            <div style={{
              width: `${goalPercentage}%`,
              height: '100%',
              background: goalMet ? 'var(--success)' : 'var(--primary)',
              transition: 'width 0.3s'
            }} />
          </div>
          {goalMet && (
            <div style={{ marginTop: '8px', color: 'var(--success)', fontSize: '14px', fontWeight: '600' }}>
              🎉 Goal Met!
            </div>
          )}
        </div>

        {/* Streak */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <TrendingUp size={20} color="var(--warning)" />
            <h3 style={{ margin: 0, fontSize: '16px' }}>Current Streak</h3>
          </div>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: 'var(--warning)' }}>
            {streak}
            <span style={{ fontSize: '18px', color: 'var(--gray-400)' }}> days</span>
          </div>
          <div style={{ marginTop: '8px', fontSize: '14px', color: 'var(--gray-600)' }}>
            {streak > 0 ? `${streak} consecutive days with 10+ outreaches` : 'Hit 10 today to start a streak!'}
          </div>
        </div>

        {/* Weekly Average */}
        <div className="card">
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Last 7 Days</h3>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: 'var(--primary)' }}>
            {weeklyStats.length > 0
              ? Math.round(weeklyStats.reduce((sum, day) => sum + Number(day.total_outreaches), 0) / weeklyStats.length)
              : 0}
            <span style={{ fontSize: '18px', color: 'var(--gray-400)' }}>/day</span>
          </div>
          <div style={{ marginTop: '8px', fontSize: '14px', color: 'var(--gray-600)' }}>
            {weeklyStats.filter(d => d.goal_met).length}/{weeklyStats.length} days hit goal
          </div>
        </div>
      </div>

      {/* Quick Add Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3>Log New Outreach</h3>
          <div className="form-grid">
            <div className="form-group">
              <label>Select Lead (Optional)</label>
              <select value={newOutreach.lead_id || ''} onChange={handleLeadSelect}>
                <option value="">-- Or enter manually below --</option>
                {leads.map(lead => (
                  <option key={lead.id} value={lead.id}>
                    {lead.name} - {lead.firm_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Outreach Type *</label>
              <select
                value={newOutreach.outreach_type}
                onChange={(e) => setNewOutreach({ ...newOutreach, outreach_type: e.target.value })}
              >
                <option value="cold_email">Cold Email</option>
                <option value="linkedin_message">LinkedIn Message</option>
                <option value="phone_call">Phone Call</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="form-group">
              <label>Lead Name *</label>
              <input
                type="text"
                value={newOutreach.lead_name}
                onChange={(e) => setNewOutreach({ ...newOutreach, lead_name: e.target.value })}
                placeholder="John Smith"
              />
            </div>

            <div className="form-group">
              <label>Firm Name</label>
              <input
                type="text"
                value={newOutreach.firm_name}
                onChange={(e) => setNewOutreach({ ...newOutreach, firm_name: e.target.value })}
                placeholder="Acme Capital"
              />
            </div>

            <div className="form-group">
              <label>Status</label>
              <select
                value={newOutreach.status}
                onChange={(e) => setNewOutreach({ ...newOutreach, status: e.target.value })}
              >
                <option value="sent">Sent</option>
                <option value="replied">Replied</option>
                <option value="no_response">No Response</option>
                <option value="bounced">Bounced</option>
              </select>
            </div>

            <div className="form-group full-width">
              <label>Notes</label>
              <textarea
                value={newOutreach.notes}
                onChange={(e) => setNewOutreach({ ...newOutreach, notes: e.target.value })}
                placeholder="Quick notes about this outreach..."
                rows={2}
              />
            </div>

            <div className="form-group full-width">
              <button className="btn btn-primary" onClick={handleAddOutreach}>
                Log Outreach
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '600' }}>View</label>
            <select
              value={filter.view}
              onChange={(e) => setFilter({ ...filter, view: e.target.value })}
              style={{ padding: '8px 12px' }}
            >
              <option value="today">Today</option>
              <option value="week">Last 7 Days</option>
              <option value="all">Last 30 Days</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '600' }}>Type</label>
            <select
              value={filter.type}
              onChange={(e) => setFilter({ ...filter, type: e.target.value })}
              style={{ padding: '8px 12px' }}
            >
              <option value="all">All Types</option>
              <option value="cold_email">Cold Email</option>
              <option value="linkedin_message">LinkedIn</option>
              <option value="phone_call">Phone Call</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '600' }}>Status</label>
            <select
              value={filter.status}
              onChange={(e) => setFilter({ ...filter, status: e.target.value })}
              style={{ padding: '8px 12px' }}
            >
              <option value="all">All Status</option>
              <option value="sent">Sent</option>
              <option value="replied">Replied</option>
              <option value="no_response">No Response</option>
              <option value="bounced">Bounced</option>
            </select>
          </div>

          <div style={{ marginLeft: 'auto' }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--gray-600)' }}>
              {outreaches.length} outreach{outreaches.length !== 1 ? 'es' : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Outreach List */}
      <div className="card">
        <h2>Outreach Log</h2>
        {outreaches.length === 0 ? (
          <div className="empty-state">
            {filter.view === 'today'
              ? "No outreaches logged today. Let's get started! 🚀"
              : "No outreaches found for this filter."}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--gray-200)', textAlign: 'left' }}>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Date</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Lead</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Firm</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Type</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Status</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Notes</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {outreaches.map(outreach => (
                  <tr key={outreach.id} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                    <td style={{ padding: '12px 8px', fontSize: '14px' }}>
                      {new Date(outreach.outreach_date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric'
                      })}
                    </td>
                    <td style={{ padding: '12px 8px', fontSize: '14px', fontWeight: '500' }}>
                      {outreach.lead_name || outreach.lead?.name}
                    </td>
                    <td style={{ padding: '12px 8px', fontSize: '14px', color: 'var(--gray-600)' }}>
                      {outreach.firm_name || outreach.lead?.firm_name || '-'}
                    </td>
                    <td style={{ padding: '12px 8px', fontSize: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {outreachTypeIcons[outreach.outreach_type]}
                        <span style={{ textTransform: 'capitalize' }}>
                          {outreach.outreach_type.replace('_', ' ')}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      <select
                        value={outreach.status}
                        onChange={(e) => handleUpdateStatus(outreach.id, e.target.value)}
                        style={{
                          padding: '4px 8px',
                          fontSize: '13px',
                          border: '1px solid var(--gray-300)',
                          borderRadius: '4px',
                          background: 'white'
                        }}
                      >
                        <option value="sent">Sent</option>
                        <option value="replied">Replied</option>
                        <option value="no_response">No Response</option>
                        <option value="bounced">Bounced</option>
                      </select>
                    </td>
                    <td style={{ padding: '12px 8px', fontSize: '13px', color: 'var(--gray-600)', maxWidth: '200px' }}>
                      {outreach.notes || '-'}
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      <button
                        className="icon-btn"
                        onClick={() => handleDelete(outreach.id)}
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default OutreachTracker
