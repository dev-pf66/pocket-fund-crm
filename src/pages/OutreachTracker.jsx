import { useState, useEffect } from 'react'
import { getOutreachLog, logOutreach, updateOutreach, deleteOutreach, getTodaysOutreachCount, getDailyOutreachStats, getOutreachStreak, getLeads } from '../lib/crm-api'
import { useApp } from '../App'
import { Target, Mail, Linkedin, Phone, MessageSquare, Trash2, CheckCircle, XCircle, Clock, TrendingUp, Upload, Eye } from 'lucide-react'

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
    notes: '',
    message_content: '',
    platform_details: '',
    fit_score: null,
    industry: '',
    deal_size: '',
    location: '',
    lead_source: ''
  })

  const [showCsvUpload, setShowCsvUpload] = useState(false)
  const [csvFile, setCsvFile] = useState(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const [selectedOutreach, setSelectedOutreach] = useState(null)
  const [showDetailsModal, setShowDetailsModal] = useState(false)

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
      await logOutreach(newOutreach, currentPerson?.id, currentPerson?.name)
      setNewOutreach({
        lead_id: null,
        lead_name: '',
        firm_name: '',
        outreach_type: 'cold_email',
        status: 'sent',
        notes: '',
        message_content: '',
        platform_details: '',
        fit_score: null,
        industry: '',
        deal_size: '',
        location: '',
        lead_source: ''
      })
      setShowForm(false)
      await loadData()
    } catch (error) {
      console.error('Failed to log outreach:', error)
      alert('Failed to log outreach')
    }
  }

  async function handleCsvUpload(e) {
    e.preventDefault()
    if (!csvFile) {
      alert('Please select a CSV file')
      return
    }

    setCsvUploading(true)
    try {
      const text = await csvFile.text()
      const rows = text.split('\n').map(row => row.split(',').map(cell => cell.trim()))
      const headers = rows[0].map(h => h.toLowerCase())

      let imported = 0
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].length < 2 || !rows[i][0]) continue // Skip empty rows

        const outreach = {}
        headers.forEach((header, idx) => {
          const value = rows[i][idx]
          if (!value) return

          // Map CSV columns to fields
          if (header.includes('lead') && header.includes('name')) outreach.lead_name = value
          else if (header.includes('firm') || header.includes('company')) outreach.firm_name = value
          else if (header.includes('type')) outreach.outreach_type = value.toLowerCase().replace(' ', '_')
          else if (header.includes('status')) outreach.status = value.toLowerCase()
          else if (header.includes('message') || header.includes('content')) outreach.message_content = value
          else if (header.includes('platform') || header.includes('where')) outreach.platform_details = value
          else if (header.includes('fit') || header.includes('score')) outreach.fit_score = parseInt(value)
          else if (header.includes('industry')) outreach.industry = value
          else if (header.includes('deal') && header.includes('size')) outreach.deal_size = value
          else if (header.includes('location')) outreach.location = value
          else if (header.includes('source')) outreach.lead_source = value
          else if (header.includes('note')) outreach.notes = value
          else if (header.includes('date')) outreach.outreach_date = value
        })

        // Set defaults
        if (!outreach.outreach_type) outreach.outreach_type = 'cold_email'
        if (!outreach.status) outreach.status = 'sent'

        await logOutreach(outreach, currentPerson?.id, currentPerson?.name)
        imported++
      }

      alert(`Successfully imported ${imported} outreaches!`)
      setCsvFile(null)
      setShowCsvUpload(false)
      await loadData()
    } catch (error) {
      console.error('CSV upload failed:', error)
      alert('Failed to upload CSV: ' + error.message)
    } finally {
      setCsvUploading(false)
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
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-secondary"
            onClick={() => setShowCsvUpload(!showCsvUpload)}
          >
            <Upload size={16} />
            CSV Upload
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? 'Cancel' : '+ Log Outreach'}
          </button>
        </div>
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

      {/* CSV Upload Form */}
      {showCsvUpload && (
        <div className="card" style={{ marginBottom: '24px', background: '#f0f9ff' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Upload size={20} />
            Bulk Upload from CSV
          </h3>
          <p style={{ color: 'var(--gray-600)', marginBottom: '16px' }}>
            Upload a CSV file with your outreach data. Required columns: <strong>lead_name</strong>
          </p>

          <div style={{ marginBottom: '16px' }}>
            <strong>Optional columns:</strong> firm_name, type, status, message_content, platform_details, fit_score (1-5), industry, deal_size, location, lead_source, notes, date
          </div>

          <form onSubmit={handleCsvUpload}>
            <div className="form-group">
              <label>Select CSV File</label>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setCsvFile(e.target.files[0])}
                style={{ padding: '8px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" className="btn btn-primary" disabled={!csvFile || csvUploading}>
                {csvUploading ? 'Uploading...' : 'Upload CSV'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowCsvUpload(false)
                  setCsvFile(null)
                }}
              >
                Cancel
              </button>
            </div>
          </form>

          <details style={{ marginTop: '16px', padding: '12px', background: 'white', borderRadius: '8px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: '600' }}>Example CSV Format</summary>
            <pre style={{ marginTop: '8px', fontSize: '12px', overflow: 'auto' }}>
{`lead_name,firm_name,type,status,fit_score,industry,message_content
John Smith,Acme Capital,cold_email,sent,5,SaaS,Sent intro email about our services
Sarah Johnson,Growth Partners,linkedin_message,replied,4,E-commerce,LinkedIn DM - she's interested!`}
            </pre>
          </details>
        </div>
      )}

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

            <div className="form-group">
              <label>Fit Score (1-5)</label>
              <select
                value={newOutreach.fit_score || ''}
                onChange={(e) => setNewOutreach({ ...newOutreach, fit_score: parseInt(e.target.value) || null })}
              >
                <option value="">Not rated</option>
                <option value="5">5 - Perfect Fit 🎯</option>
                <option value="4">4 - Good Fit ✅</option>
                <option value="3">3 - Okay Fit 👌</option>
                <option value="2">2 - Poor Fit ⚠️</option>
                <option value="1">1 - Bad Fit ❌</option>
              </select>
            </div>

            <div className="form-group">
              <label>Industry</label>
              <input
                type="text"
                value={newOutreach.industry}
                onChange={(e) => setNewOutreach({ ...newOutreach, industry: e.target.value })}
                placeholder="e.g., SaaS, E-commerce"
              />
            </div>

            <div className="form-group">
              <label>Deal Size</label>
              <input
                type="text"
                value={newOutreach.deal_size}
                onChange={(e) => setNewOutreach({ ...newOutreach, deal_size: e.target.value })}
                placeholder="e.g., $1M-$5M"
              />
            </div>

            <div className="form-group">
              <label>Location</label>
              <input
                type="text"
                value={newOutreach.location}
                onChange={(e) => setNewOutreach({ ...newOutreach, location: e.target.value })}
                placeholder="e.g., New York, Remote"
              />
            </div>

            <div className="form-group">
              <label>Lead Source</label>
              <input
                type="text"
                value={newOutreach.lead_source}
                onChange={(e) => setNewOutreach({ ...newOutreach, lead_source: e.target.value })}
                placeholder="e.g., LinkedIn, Referral, Conference"
              />
            </div>

            <div className="form-group full-width">
              <label>Platform Details (Where?)</label>
              <input
                type="text"
                value={newOutreach.platform_details}
                onChange={(e) => setNewOutreach({ ...newOutreach, platform_details: e.target.value })}
                placeholder="e.g., LinkedIn DM, Email to john@acme.com, Phone +1234567890"
              />
            </div>

            <div className="form-group full-width">
              <label>Message Content (What did you say?)</label>
              <textarea
                value={newOutreach.message_content}
                onChange={(e) => setNewOutreach({ ...newOutreach, message_content: e.target.value })}
                placeholder="Copy/paste the actual message you sent..."
                rows={4}
              />
            </div>

            <div className="form-group full-width">
              <label>Additional Notes</label>
              <textarea
                value={newOutreach.notes}
                onChange={(e) => setNewOutreach({ ...newOutreach, notes: e.target.value })}
                placeholder="Any other notes about this outreach..."
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
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Industry</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Fit</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Type</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600', fontSize: '14px' }}>Status</th>
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
                    <td style={{ padding: '12px 8px', fontSize: '13px', color: 'var(--gray-600)' }}>
                      {outreach.industry || '-'}
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      {outreach.fit_score ? (
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '12px',
                          fontSize: '13px',
                          fontWeight: '600',
                          background:
                            outreach.fit_score >= 4 ? '#d1fae5' :
                            outreach.fit_score >= 3 ? '#fef3c7' : '#fee2e2',
                          color:
                            outreach.fit_score >= 4 ? '#065f46' :
                            outreach.fit_score >= 3 ? '#92400e' : '#991b1b'
                        }}>
                          {outreach.fit_score}/5
                        </span>
                      ) : (
                        <span style={{ color: 'var(--gray-400)' }}>-</span>
                      )}
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
                    <td style={{ padding: '12px 8px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          className="icon-btn"
                          onClick={() => {
                            setSelectedOutreach(outreach)
                            setShowDetailsModal(true)
                          }}
                          title="View Details"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => handleDelete(outreach.id)}
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Details Modal */}
      {showDetailsModal && selectedOutreach && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setShowDetailsModal(false)}
        >
          <div
            className="card"
            style={{
              width: '90%',
              maxWidth: '700px',
              maxHeight: '90vh',
              overflow: 'auto',
              margin: '20px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Outreach Details</h2>
              <button
                className="icon-btn"
                onClick={() => setShowDetailsModal(false)}
                style={{ fontSize: '24px' }}
              >
                ×
              </button>
            </div>

            <div className="info-grid">
              <div className="info-item">
                <label>Lead</label>
                <div style={{ fontWeight: '600' }}>{selectedOutreach.lead_name || selectedOutreach.lead?.name}</div>
              </div>

              <div className="info-item">
                <label>Firm</label>
                <div>{selectedOutreach.firm_name || selectedOutreach.lead?.firm_name || '-'}</div>
              </div>

              <div className="info-item">
                <label>Industry</label>
                <div>{selectedOutreach.industry || '-'}</div>
              </div>

              <div className="info-item">
                <label>Fit Score</label>
                <div>
                  {selectedOutreach.fit_score ? (
                    <span style={{
                      padding: '4px 12px',
                      borderRadius: '12px',
                      fontSize: '14px',
                      fontWeight: '600',
                      background:
                        selectedOutreach.fit_score >= 4 ? '#d1fae5' :
                        selectedOutreach.fit_score >= 3 ? '#fef3c7' : '#fee2e2',
                      color:
                        selectedOutreach.fit_score >= 4 ? '#065f46' :
                        selectedOutreach.fit_score >= 3 ? '#92400e' : '#991b1b'
                    }}>
                      {selectedOutreach.fit_score}/5
                      {selectedOutreach.fit_score >= 4 && ' 🎯'}
                      {selectedOutreach.fit_score === 3 && ' 👌'}
                      {selectedOutreach.fit_score <= 2 && ' ⚠️'}
                    </span>
                  ) : '-'}
                </div>
              </div>

              <div className="info-item">
                <label>Deal Size</label>
                <div>{selectedOutreach.deal_size || '-'}</div>
              </div>

              <div className="info-item">
                <label>Location</label>
                <div>{selectedOutreach.location || '-'}</div>
              </div>

              <div className="info-item">
                <label>Lead Source</label>
                <div>{selectedOutreach.lead_source || '-'}</div>
              </div>

              <div className="info-item">
                <label>Date</label>
                <div>{new Date(selectedOutreach.outreach_date).toLocaleDateString()}</div>
              </div>

              <div className="info-item">
                <label>Type</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {outreachTypeIcons[selectedOutreach.outreach_type]}
                  <span style={{ textTransform: 'capitalize' }}>
                    {selectedOutreach.outreach_type.replace('_', ' ')}
                  </span>
                </div>
              </div>

              <div className="info-item">
                <label>Status</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {statusIcons[selectedOutreach.status]}
                  <span style={{ textTransform: 'capitalize' }}>
                    {selectedOutreach.status.replace('_', ' ')}
                  </span>
                </div>
              </div>

              {selectedOutreach.platform_details && (
                <div className="info-item full-width">
                  <label>Platform / Where Contacted</label>
                  <div>{selectedOutreach.platform_details}</div>
                </div>
              )}

              {selectedOutreach.message_content && (
                <div className="info-item full-width">
                  <label>Message Sent</label>
                  <div style={{
                    background: 'var(--gray-50)',
                    padding: '12px',
                    borderRadius: '8px',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'system-ui',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    border: '1px solid var(--gray-200)'
                  }}>
                    {selectedOutreach.message_content}
                  </div>
                </div>
              )}

              {selectedOutreach.notes && (
                <div className="info-item full-width">
                  <label>Additional Notes</label>
                  <div style={{ whiteSpace: 'pre-wrap', color: 'var(--gray-600)' }}>
                    {selectedOutreach.notes}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default OutreachTracker
