import { useState, useEffect } from 'react'
import { getOutreachLog, logOutreach, logOutreachBatch, updateOutreach, deleteOutreach, getPersonDashboardStats, getLeads, createLead, findLeadByLinkedInUrl, updateLead, getEmailTemplates } from '../lib/crm-api'
import { isLinkedInUrl, nameFromLinkedInUrl } from '../lib/linkedin'
import { useApp } from '../App'
import { Target, Mail, Linkedin, Phone, MessageSquare, Trash2, CheckCircle, XCircle, Clock, TrendingUp, Upload, Edit2, Zap } from 'lucide-react'
import { useFieldOptions } from '../hooks/useFieldOptions'
import { useToast } from '../components/Toast'
import { useSessionState } from '../hooks/useSessionState'
import { istToday } from '../lib/dateUtils'
import { parseCSVText, parseDateCell } from '../lib/csv'

// Map free-text CSV values into the canonical dropdown keys the table uses.
// Without this, a row that says "Cold Email" or "LinkedIn" would import as
// the literal string and not match the filter / status dropdowns.
function normalizeOutreachType(raw) {
  const v = String(raw || '').toLowerCase().trim()
  if (!v) return null
  if (['cold_email', 'linkedin_message', 'phone_call', 'other'].includes(v)) return v
  if (v.includes('linkedin') || v === 'li' || v === 'li msg' || v === 'in mail' || v === 'inmail') return 'linkedin_message'
  if (v.includes('email') || v === 'mail' || v === 'cold') return 'cold_email'
  if (v.includes('phone') || v.includes('call')) return 'phone_call'
  return 'other'
}

function normalizeOutreachStatus(raw) {
  const v = String(raw || '').toLowerCase().trim()
  if (!v) return null
  if (['sent', 'replied', 'no_response', 'bounced'].includes(v)) return v
  if (v.includes('repli') || v.includes('respond') || v === 'yes' || v === 'got reply') return 'replied'
  if (v.includes('bounce')) return 'bounced'
  if (v.includes('no response') || v === 'no') return 'no_response'
  return 'sent'
}

const EMPTY_OUTREACH = {
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
}

function OutreachTracker() {
  const { currentPerson } = useApp()
  const { toast } = useToast()
  const industryOptions = useFieldOptions('industry')
  const dealSizeOptions = useFieldOptions('deal_size')
  const locationOptions = useFieldOptions('location')
  const leadSourceOptions = useFieldOptions('lead_source')
  const [outreaches, setOutreaches] = useState([])
  const [templates, setTemplates] = useState([])
  const [todayCount, setTodayCount] = useState(0)
  const [streak, setStreak] = useState(0)
  const [weeklyStats, setWeeklyStats] = useState([])
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)

  // Persist in-progress form input across page navigations within the tab.
  const [showForm, setShowForm] = useSessionState('ot:showForm', false)
  const [newOutreach, setNewOutreach, clearNewOutreach] = useSessionState('ot:newOutreach', EMPTY_OUTREACH)
  const [quickUrl, setQuickUrl] = useSessionState('ot:quickUrl', '')

  const [showCsvUpload, setShowCsvUpload] = useState(false)
  const [csvFile, setCsvFile] = useState(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const [selectedOutreach, setSelectedOutreach] = useState(null)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  // Pending edits inside the details modal — only fields the user actually
  // changed are sent on save, so unrelated columns aren't clobbered.
  const [editedFields, setEditedFields] = useState({})
  const [savingEdits, setSavingEdits] = useState(false)

  const [quickLogging, setQuickLogging] = useState(false)

  const [filter, setFilter] = useState({
    view: 'today', // 'today', 'week', 'all'
    type: 'all',
    status: 'all'
  })

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, currentPerson?.id])

  async function loadData() {
    if (!currentPerson?.id) return
    setLoading(true)
    try {
      const [dashStats, leadsData, templateData] = await Promise.all([
        getPersonDashboardStats(currentPerson.id, { weekDays: 7, daysBack: 30 }),
        getLeads({ stage: 'cold_outreach' }, currentPerson.id),
        getEmailTemplates().catch(() => [])
      ])

      setTodayCount(dashStats.todayCount)
      setStreak(dashStats.streak)
      setWeeklyStats(dashStats.dailyStats)
      setLeads(leadsData)
      setTemplates(templateData)

      // Get outreaches based on filter
      const filters = {}
      if (filter.view === 'today') {
        filters.outreach_date = istToday()
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

      const outreachData = await getOutreachLog(filters, currentPerson.id)
      setOutreaches(outreachData)
    } catch (error) {
      console.error('Failed to load outreach data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleQuickLog() {
    const url = quickUrl.trim()
    if (!url) {
      toast.warn('Paste a LinkedIn URL first')
      return
    }
    if (!isLinkedInUrl(url)) {
      toast.warn("That doesn't look like a LinkedIn URL")
      return
    }

    setQuickLogging(true)
    try {
      // Reuse existing lead if we already have one for this profile;
      // otherwise create a fresh lead so the outreach is linked.
      let lead = await findLeadByLinkedInUrl(url)
      let leadCreated = false
      if (!lead) {
        const guessedName = nameFromLinkedInUrl(url) || 'Unknown'
        lead = await createLead({
          name: guessedName,
          linkedin_url: url,
          stage: 'cold_outreach',
          lead_source: 'LinkedIn'
        }, currentPerson?.id)
        leadCreated = true
      }

      await logOutreach({
        lead_id: lead.id,
        lead_name: lead.name,
        firm_name: lead.firm_name || '',
        outreach_type: 'linkedin_message',
        status: 'sent',
        platform_details: url
      }, currentPerson?.id, currentPerson?.name)

      setQuickUrl('')
      toast.success(leadCreated ? `Logged + created lead "${lead.name}"` : `Logged DM to ${lead.name}`)
      await loadData()
    } catch (error) {
      console.error('Quick-log failed:', error)
      toast.error('Quick-log failed: ' + error.message)
    } finally {
      setQuickLogging(false)
    }
  }

  async function handleAddOutreach() {
    if (!newOutreach.lead_name && !newOutreach.lead_id) {
      toast.warn('Please enter a lead name or select from dropdown')
      return
    }

    try {
      await logOutreach(newOutreach, currentPerson?.id, currentPerson?.name)
      clearNewOutreach()
      setShowForm(false)
      await loadData()
    } catch (error) {
      console.error('Failed to log outreach:', error)
      toast.error('Failed to log outreach')
    }
  }

  async function handleCsvUpload(e) {
    e.preventDefault()
    if (!csvFile) {
      toast.warn('Please select a CSV file')
      return
    }

    setCsvUploading(true)
    try {
      const text = await csvFile.text()
      const rows = parseCSVText(text)
      if (rows.length < 2) {
        toast.warn('CSV has no data rows')
        return
      }
      const headers = rows[0].map(h => h.trim().toLowerCase())

      const validRows = []
      let skipped = 0
      for (let i = 1; i < rows.length; i++) {
        const outreach = {}
        headers.forEach((header, idx) => {
          const raw = rows[i][idx]
          if (raw === undefined) return
          const value = String(raw).trim()
          if (!value) return

          // Map CSV columns to fields. Order matters — check for more
          // specific headers (deal + size, lead + name) before generic ones.
          if (header.includes('lead') && header.includes('name')) outreach.lead_name = value
          else if (header.includes('firm') || header.includes('company')) outreach.firm_name = value
          else if (header.includes('type') || header.includes('channel')) {
            const t = normalizeOutreachType(value)
            if (t) outreach.outreach_type = t
          }
          else if (header.includes('status') || header === 'response' || header === 'replied') {
            const s = normalizeOutreachStatus(value)
            if (s) outreach.status = s
          }
          else if (header.includes('message') || header.includes('content')) outreach.message_content = value
          else if (header.includes('platform') || header.includes('where')) outreach.platform_details = value
          else if (header.includes('fit') || header.includes('score')) {
            const n = parseInt(value, 10)
            if (Number.isFinite(n)) outreach.fit_score = n
          }
          else if (header.includes('industry')) outreach.industry = value
          else if (header.includes('deal') && header.includes('size')) outreach.deal_size = value
          else if (header.includes('location')) outreach.location = value
          else if (header.includes('source')) outreach.lead_source = value
          else if (header.includes('note')) outreach.notes = value
          else if (header.includes('date')) {
            const d = parseDateCell(value)
            if (d) outreach.outreach_date = d
          }
        })

        if (!outreach.lead_name) { skipped += 1; continue }

        // Set defaults
        if (!outreach.outreach_type) outreach.outreach_type = 'cold_email'
        if (!outreach.status) outreach.status = 'sent'

        validRows.push(outreach)
      }

      if (validRows.length === 0) {
        toast.warn(skipped > 0
          ? `All ${skipped} rows were skipped — no lead_name found`
          : 'No valid rows found in CSV')
        return
      }

      // Single batch insert instead of N sequential calls
      const imported = await logOutreachBatch(validRows, currentPerson?.id)

      const msg = skipped > 0
        ? `Imported ${imported} · skipped ${skipped} row${skipped === 1 ? '' : 's'} without a lead name`
        : `Imported ${imported} outreach entr${imported === 1 ? 'y' : 'ies'}`
      toast.success(msg)
      setCsvFile(null)
      setShowCsvUpload(false)
      // Switch to "all" view so imported entries are visible regardless of
      // what date the CSV had — avoids the "upload succeeded but nothing
      // appears" confusion when CSV dates aren't today.
      setFilter(f => ({ ...f, view: 'all' }))
    } catch (error) {
      console.error('CSV upload failed:', error)
      toast.error('Failed to upload CSV: ' + error.message)
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
      toast.error('Failed to update status')
    }
  }

  async function handleSaveEdits() {
    if (!selectedOutreach) return
    const dirtyKeys = Object.keys(editedFields)
    if (dirtyKeys.length === 0) {
      setShowDetailsModal(false)
      return
    }
    setSavingEdits(true)
    try {
      const updates = {}
      for (const k of dirtyKeys) {
        let v = editedFields[k]
        if (k === 'fit_score') {
          v = (v === null || v === '') ? null : Number(v)
          if (v !== null && (!Number.isFinite(v) || v < 1 || v > 5)) v = null
        }
        if (k === 'outreach_date' && !v) v = null
        updates[k] = v
      }
      await updateOutreach(selectedOutreach.id, updates)
      setOutreaches(prev => prev.map(o => o.id === selectedOutreach.id ? { ...o, ...updates } : o))
      toast.success('Outreach updated')
      setShowDetailsModal(false)
      setEditedFields({})
    } catch (err) {
      console.error('Failed to update outreach:', err)
      toast.error('Failed to update: ' + err.message)
    } finally {
      setSavingEdits(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this outreach entry?')) return

    try {
      await deleteOutreach(id)
      await loadData()
    } catch (error) {
      console.error('Failed to delete outreach:', error)
      toast.error('Failed to delete outreach')
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
        <h1>Tracker</h1>
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

      {/* Quick log: paste LinkedIn URL → creates lead (if new) + logs DM */}
      <div className="card" style={{ marginBottom: '20px', padding: '16px', background: 'linear-gradient(to right, #eff6ff, #f0f9ff)', border: '1px solid #bfdbfe' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <Zap size={18} color="#1d4ed8" />
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '600', color: '#1e3a8a' }}>
            Quick log a LinkedIn DM
          </h3>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            Paste a profile URL — we'll create the lead and log it.
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Linkedin size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
            <input
              type="url"
              value={quickUrl}
              onChange={(e) => setQuickUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleQuickLog() }}
              placeholder="https://linkedin.com/in/..."
              disabled={quickLogging}
              style={{ width: '100%', padding: '10px 10px 10px 34px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px', background: 'white' }}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleQuickLog}
            disabled={quickLogging || !quickUrl.trim()}
            style={{ whiteSpace: 'nowrap' }}
          >
            {quickLogging ? 'Logging…' : 'Log DM'}
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
              <select value={newOutreach.industry} onChange={(e) => setNewOutreach({ ...newOutreach, industry: e.target.value })}>
                <option value="">Select industry…</option>
                {industryOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>Deal Size</label>
              <select value={newOutreach.deal_size} onChange={(e) => setNewOutreach({ ...newOutreach, deal_size: e.target.value })}>
                <option value="">Select deal size…</option>
                {dealSizeOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>Location</label>
              <select value={newOutreach.location} onChange={(e) => setNewOutreach({ ...newOutreach, location: e.target.value })}>
                <option value="">Select location…</option>
                {locationOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>Lead Source</label>
              <select value={newOutreach.lead_source} onChange={(e) => setNewOutreach({ ...newOutreach, lead_source: e.target.value })}>
                <option value="">Select source…</option>
                {leadSourceOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
              </select>
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
              <label>Message Sent</label>
              {templates.length > 0 && (
                <select
                  style={{ marginBottom: '6px' }}
                  defaultValue=""
                  onChange={(e) => {
                    const t = templates.find(t => String(t.id) === e.target.value)
                    if (t) setNewOutreach({ ...newOutreach, message_content: t.body })
                    e.target.value = ''
                  }}
                >
                  <option value="">Use a template…</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
              <textarea
                value={newOutreach.message_content}
                onChange={(e) => setNewOutreach({ ...newOutreach, message_content: e.target.value })}
                placeholder="Copy/paste or type the message you sent…"
                rows={5}
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
                          {outreach.outreach_type.replace(/_/g, ' ')}
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
                            setEditedFields({})
                            setShowDetailsModal(true)
                          }}
                          title="View / Edit"
                        >
                          <Edit2 size={16} />
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
              <h2 style={{ margin: 0 }}>Edit Outreach</h2>
              <button
                className="icon-btn"
                onClick={() => { setShowDetailsModal(false); setEditedFields({}) }}
                style={{ fontSize: '24px' }}
              >
                ×
              </button>
            </div>

            {(() => {
              const fv = (field) => editedFields[field] !== undefined ? editedFields[field] : (selectedOutreach[field] ?? '')
              const setField = (field, value) => setEditedFields(prev => ({ ...prev, [field]: value }))
              return (
                <div className="info-grid">
                  <div className="info-item">
                    <label>Lead</label>
                    <input
                      type="text"
                      value={fv('lead_name')}
                      onChange={(e) => setField('lead_name', e.target.value)}
                      placeholder="Lead name"
                    />
                  </div>

                  <div className="info-item">
                    <label>Firm</label>
                    <input
                      type="text"
                      value={fv('firm_name')}
                      onChange={(e) => setField('firm_name', e.target.value)}
                      placeholder="Firm / company"
                    />
                  </div>

                  <div className="info-item">
                    <label>Industry</label>
                    <select value={fv('industry')} onChange={(e) => setField('industry', e.target.value)}>
                      <option value="">Select industry…</option>
                      {industryOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
                    </select>
                  </div>

                  <div className="info-item">
                    <label>Fit Score (1-5)</label>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={fv('fit_score') || ''}
                      onChange={(e) => setField('fit_score', e.target.value === '' ? null : parseInt(e.target.value, 10))}
                      placeholder="1-5"
                    />
                  </div>

                  <div className="info-item">
                    <label>Deal Size</label>
                    <select value={fv('deal_size')} onChange={(e) => setField('deal_size', e.target.value)}>
                      <option value="">Select deal size…</option>
                      {dealSizeOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
                    </select>
                  </div>

                  <div className="info-item">
                    <label>Location</label>
                    <select value={fv('location')} onChange={(e) => setField('location', e.target.value)}>
                      <option value="">Select location…</option>
                      {locationOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
                    </select>
                  </div>

                  <div className="info-item">
                    <label>Lead Source</label>
                    <select value={fv('lead_source')} onChange={(e) => setField('lead_source', e.target.value)}>
                      <option value="">Select source…</option>
                      {leadSourceOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
                    </select>
                  </div>

                  {selectedOutreach?.lead?.id && (
                    <div className="info-item">
                      <label>Lead Stage</label>
                      <select
                        defaultValue={selectedOutreach.lead?.outreach_stage || ''}
                        onChange={async (e) => {
                          const val = e.target.value
                          try {
                            await updateLead(selectedOutreach.lead.id, { outreach_stage: val || null })
                            setOutreaches(prev => prev.map(o =>
                              o.id === selectedOutreach.id
                                ? { ...o, lead: { ...o.lead, outreach_stage: val } }
                                : o
                            ))
                          } catch (err) {
                            toast.error('Failed to save lead stage: ' + err.message)
                          }
                        }}
                      >
                        <option value="">—</option>
                        <option value="cold">Cold</option>
                        <option value="messaged">Messaged</option>
                        <option value="replied">Replied</option>
                        <option value="meeting">Meeting</option>
                      </select>
                    </div>
                  )}

                  <div className="info-item">
                    <label>Date</label>
                    <input
                      type="date"
                      value={fv('outreach_date') ? String(fv('outreach_date')).slice(0, 10) : ''}
                      onChange={(e) => setField('outreach_date', e.target.value)}
                    />
                  </div>

                  <div className="info-item">
                    <label>Type</label>
                    <select
                      value={fv('outreach_type') || 'cold_email'}
                      onChange={(e) => setField('outreach_type', e.target.value)}
                    >
                      <option value="cold_email">Cold Email</option>
                      <option value="linkedin_message">LinkedIn Message</option>
                      <option value="phone_call">Phone Call</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div className="info-item">
                    <label>Status</label>
                    <select
                      value={fv('status') || 'sent'}
                      onChange={(e) => setField('status', e.target.value)}
                    >
                      <option value="sent">Sent</option>
                      <option value="replied">Replied</option>
                      <option value="no_response">No Response</option>
                      <option value="bounced">Bounced</option>
                    </select>
                  </div>

                  <div className="info-item full-width">
                    <label>Platform / Where Contacted</label>
                    <input
                      type="text"
                      value={fv('platform_details')}
                      onChange={(e) => setField('platform_details', e.target.value)}
                      placeholder="e.g., LinkedIn DM, john@acme.com"
                    />
                  </div>

                  <div className="info-item full-width">
                    <label>Message Sent</label>
                    {templates.length > 0 && (
                      <select
                        style={{ marginBottom: '6px' }}
                        defaultValue=""
                        onChange={(e) => {
                          const t = templates.find(t => String(t.id) === e.target.value)
                          if (t) setField('message_content', t.body)
                          e.target.value = ''
                        }}
                      >
                        <option value="">Use a template…</option>
                        {templates.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    )}
                    <textarea
                      value={fv('message_content')}
                      onChange={(e) => setField('message_content', e.target.value)}
                      rows={5}
                      placeholder="The actual message you sent..."
                    />
                  </div>

                  <div className="info-item full-width">
                    <label>Additional Notes</label>
                    <textarea
                      value={fv('notes')}
                      onChange={(e) => setField('notes', e.target.value)}
                      rows={3}
                      placeholder="Any other notes..."
                    />
                  </div>
                </div>
              )
            })()}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--gray-200)' }}>
              <button
                className="btn btn-secondary"
                onClick={() => { setShowDetailsModal(false); setEditedFields({}) }}
                disabled={savingEdits}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveEdits}
                disabled={savingEdits || Object.keys(editedFields).length === 0}
              >
                {savingEdits ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default OutreachTracker
