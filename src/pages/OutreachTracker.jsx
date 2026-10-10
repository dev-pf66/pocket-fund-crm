import { useState, useEffect, useRef } from 'react'
import { getOutreachLog, logOutreach, logOutreachBatch, updateOutreach, deleteOutreach, getPersonDashboardStats, getLeads, createLead, findLeadByLinkedInUrl, updateLead, getEmailTemplates } from '../lib/crm-api'
import { isLinkedInUrl, nameFromLinkedInUrl } from '../lib/linkedin'
import { useApp } from '../App'
import { Target, Mail, Linkedin, Phone, MessageSquare, Trash2, CheckCircle, XCircle, Clock, TrendingUp, Upload, Edit2, Zap, X, AlertTriangle, ExternalLink } from 'lucide-react'
import { useFieldOptions } from '../hooks/useFieldOptions'
import { useToast } from '../components/Toast'
import { useSessionState } from '../hooks/useSessionState'
import { dailyTargetOf, hasTarget } from '../lib/targets'
import { istToday } from '../lib/dateUtils'
import { parseCSVText, parseDateCell } from '../lib/csv'
import { OUTREACH_STATUSES, normalizeOutreachStatus } from '../lib/outreachStatus'

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
  const { currentPerson, people } = useApp()
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

  // Real-time LinkedIn URL dedup check
  const urlCheckTimer = useRef(null)
  const [urlCheck, setUrlCheck] = useState({ status: 'idle', lead: null }) // idle|checking|found|not_found

  // Post-add result modal (single entry)
  const [entryResult, setEntryResult] = useState(null) // { lead, isNew, outreach } | null
  const [entryEdits, setEntryEdits] = useState({})
  const [entrySaving, setEntrySaving] = useState(false)

  // CSV preview modal (shown before actual import)
  const [csvPreview, setCsvPreview] = useState(null) // { rows: [{...fields, _dupe, _existingLead, _edits}] } | null
  const [csvImporting, setCsvImporting] = useState(false)

  useEffect(() => {
    clearTimeout(urlCheckTimer.current)
    const url = quickUrl.trim()
    if (!isLinkedInUrl(url)) {
      setUrlCheck(c => c.status === 'idle' ? c : { status: 'idle', lead: null })
      return
    }
    setUrlCheck({ status: 'checking', lead: null })
    urlCheckTimer.current = setTimeout(async () => {
      try {
        const lead = await findLeadByLinkedInUrl(url)
        setUrlCheck({ status: lead ? 'found' : 'not_found', lead: lead || null })
      } catch {
        setUrlCheck({ status: 'idle', lead: null })
      }
    }, 450)
    return () => clearTimeout(urlCheckTimer.current)
  }, [quickUrl])

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
        getPersonDashboardStats(currentPerson.id, { weekDays: 7, daysBack: 30, dailyGoal: dailyTargetOf(currentPerson) }),
        getLeads({}, currentPerson.id),
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
      setUrlCheck({ status: 'idle', lead: null })
      setEntryResult({ lead, isNew: leadCreated, outreach: { outreach_type: 'linkedin_message', status: 'sent', platform_details: url } })
      setEntryEdits({})
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
      let outreachData = { ...newOutreach }

      // Auto-create a lead record when the user typed a name manually
      // (no lead_id from the dropdown). Without this, the outreach entry
      // has a dangling lead_name string that never appears in the pipeline.
      if (outreachData.lead_name && !outreachData.lead_id) {
        const lead = await createLead({
          name: outreachData.lead_name.trim(),
          firm_name: outreachData.firm_name || null,
          lead_source: outreachData.lead_source || null,
          industry: outreachData.industry || null,
          stage: 'cold_outreach'
        }, currentPerson?.id)
        outreachData = { ...outreachData, lead_id: lead.id }
      }

      await logOutreach(outreachData, currentPerson?.id, currentPerson?.name)
      const leadForModal = outreachData.lead_id
        ? leads.find(l => l.id === outreachData.lead_id) || { id: outreachData.lead_id, name: outreachData.lead_name, firm_name: outreachData.firm_name }
        : { name: outreachData.lead_name, firm_name: outreachData.firm_name }
      setEntryResult({ lead: leadForModal, isNew: !outreachData.lead_id || !newOutreach.lead_id, outreach: outreachData })
      setEntryEdits({})
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

      // Dedup check against already-loaded leads (name+firm, case-insensitive)
      const byNameFirm = new Map()
      for (const l of leads) {
        const key = `${(l.name || '').toLowerCase()}|${(l.firm_name || '').toLowerCase()}`
        byNameFirm.set(key, l)
      }
      const previewRows = validRows.map(row => {
        const key = `${(row.lead_name || '').toLowerCase()}|${(row.firm_name || '').toLowerCase()}`
        const nameOnly = `${(row.lead_name || '').toLowerCase()}|`
        const existing = byNameFirm.get(key) || byNameFirm.get(nameOnly) || null
        return { ...row, _dupe: !!existing, _existingLead: existing, _edits: {} }
      })
      setCsvPreview({ rows: previewRows, skipped })
      setCsvFile(null)
      setShowCsvUpload(false)
    } catch (error) {
      console.error('CSV upload failed:', error)
      toast.error('Failed to upload CSV: ' + error.message)
    } finally {
      setCsvUploading(false)
    }
  }

  async function handleCsvImport() {
    if (!csvPreview) return
    setCsvImporting(true)
    try {
      // Apply any in-modal edits before importing
      const rows = csvPreview.rows.map(r => {
        const { _dupe, _existingLead, _edits, ...base } = r
        return { ...base, ..._edits }
      })
      const imported = await logOutreachBatch(rows, currentPerson?.id)
      setCsvPreview(null)
      toast.success(`Imported ${imported} outreach entr${imported === 1 ? 'y' : 'ies'}`)
      setFilter(f => ({ ...f, view: 'all' }))
      await loadData()
    } catch (err) {
      console.error('CSV import failed:', err)
      toast.error('Import failed: ' + err.message)
    } finally {
      setCsvImporting(false)
    }
  }

  async function handleEntrySave() {
    if (!entryResult?.lead?.id || Object.keys(entryEdits).length === 0) {
      setEntryResult(null)
      return
    }
    setEntrySaving(true)
    try {
      await updateLead(entryResult.lead.id, entryEdits)
      toast.success('Lead updated')
      setEntryResult(null)
      setEntryEdits({})
      await loadData()
    } catch (err) {
      console.error('Failed to save lead:', err)
      toast.error('Failed to save: ' + err.message)
    } finally {
      setEntrySaving(false)
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

  // Today's target comes from the person, not from a constant. The 10 that was
  // hardcoded here is the old DEFAULT_DAILY_TARGET, which was deliberately set to
  // 0 in Aug 2026 when sales moved to a low-volume, high-targeting motion — so
  // this card was telling every analyst their goal was 10 sends a day and
  // congratulating them for hitting a quota Dev had abandoned. Same bug as the
  // Dashboard's "Today's Outreach" card, which was replaced by the scoreboard.
  // Targets stay fluid: if someone HAS a target the meter means something, and if
  // they don't there is simply no meter rather than a false one.
  const myTarget = dailyTargetOf(currentPerson)
  const hasGoal = hasTarget(myTarget)
  const goalPercentage = hasGoal ? Math.min((todayCount / myTarget) * 100, 100) : 0
  const goalMet = hasGoal && todayCount >= myTarget

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
        {urlCheck.status === 'checking' && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', border: '2px solid #6b7280', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
            Checking database…
          </div>
        )}
        {urlCheck.status === 'found' && urlCheck.lead && (
          <div style={{ marginTop: '8px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '5px 10px', color: '#92400e' }}>
            <AlertTriangle size={13} style={{ flexShrink: 0 }} />
            <span>Already in DB — <strong>{urlCheck.lead.name}</strong>{urlCheck.lead.firm_name ? ` · ${urlCheck.lead.firm_name}` : ''}{urlCheck.lead.stage ? ` · Stage: ${urlCheck.lead.stage.replace(/_/g, ' ')}` : ''}</span>
            {urlCheck.lead.id && (
              <a href={`/leads/${urlCheck.lead.id}`} target="_blank" rel="noreferrer" style={{ marginLeft: '4px', color: '#b45309' }}>
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        )}
        {urlCheck.status === 'not_found' && (
          <div style={{ marginTop: '8px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '5px 10px', color: '#166534' }}>
            <CheckCircle size={13} style={{ flexShrink: 0 }} />
            New lead — not in the database yet
          </div>
        )}
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
            {hasGoal && <span style={{ fontSize: '18px', color: 'var(--gray-400)' }}>/{myTarget}</span>}
          </div>
          {!hasGoal && (
            <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '4px' }}>
              touches logged today — no target set
            </div>
          )}
          {hasGoal && (
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
          )}
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
          {/* The bar is the person's own target, or "any outreach" when they have
              none. This copy used to hardcode 10 — so it told every analyst to hit
              a quota that was zeroed in Aug 2026 and that nobody has ever reached,
              which meant it permanently read "Hit 10 today to start a streak!". */}
          <div style={{ marginTop: '8px', fontSize: '14px', color: 'var(--gray-600)' }}>
            {streak > 0
              ? `${streak} consecutive days ${hasGoal ? `hitting ${myTarget}` : 'with outreach'}`
              : hasGoal ? `Hit ${myTarget} today to start a streak` : 'Log outreach today to start a streak'}
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
                {OUTREACH_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
              {OUTREACH_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
                        {OUTREACH_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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

      {/* Entry Result Modal — shown after quick-log or manual add */}
      {entryResult && (
        <EntryResultModal
          lead={entryResult.lead}
          isNew={entryResult.isNew}
          outreach={entryResult.outreach}
          edits={entryEdits}
          setEdits={setEntryEdits}
          saving={entrySaving}
          people={people}
          currentPersonId={currentPerson?.id}
          industryOptions={industryOptions}
          dealSizeOptions={dealSizeOptions}
          locationOptions={locationOptions}
          leadSourceOptions={leadSourceOptions}
          onSave={handleEntrySave}
          onClose={() => { setEntryResult(null); setEntryEdits({}) }}
        />
      )}

      {/* CSV Preview Modal — shown after parsing, before import */}
      {csvPreview && (
        <CsvPreviewModal
          rows={csvPreview.rows}
          skipped={csvPreview.skipped}
          importing={csvImporting}
          people={people}
          currentPersonId={currentPerson?.id}
          industryOptions={industryOptions}
          dealSizeOptions={dealSizeOptions}
          locationOptions={locationOptions}
          leadSourceOptions={leadSourceOptions}
          onRowEdit={(idx, field, value) => {
            setCsvPreview(prev => {
              const rows = [...prev.rows]
              rows[idx] = { ...rows[idx], _edits: { ...rows[idx]._edits, [field]: value } }
              return { ...prev, rows }
            })
          }}
          onImport={handleCsvImport}
          onClose={() => setCsvPreview(null)}
        />
      )}

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
                      {OUTREACH_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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

const STAGE_LABELS = {
  cold_outreach: 'Cold Outreach', outreach: 'Outreach', responded: 'Responded',
  meeting_booked: 'Meeting Booked', warm_active: 'Warm / Active', client: 'Client', passed: 'Passed'
}

const OUTREACH_TYPE_LABELS = { cold_email: 'Cold Email', linkedin_message: 'LinkedIn', phone_call: 'Phone', other: 'Other' }
const STATUS_LABELS = { sent: 'Sent', replied: 'Replied', no_response: 'No Response', bounced: 'Bounced' }

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 2000, padding: '16px'
}
const modalBoxStyle = {
  background: 'white', borderRadius: '12px', width: '100%', maxWidth: '560px',
  maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
}

function EntryResultModal({ lead, isNew, outreach, edits, setEdits, saving, people = [], currentPersonId, industryOptions, dealSizeOptions, locationOptions, leadSourceOptions, onSave, onClose }) {
  const fv = k => edits[k] !== undefined ? edits[k] : (lead?.[k] ?? '')
  const set = (k, v) => setEdits(prev => ({ ...prev, [k]: v }))
  const dirty = Object.keys(edits).length > 0 && !!lead?.id
  const inputStyle = { width: '100%', padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px', background: 'white', boxSizing: 'border-box' }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalBoxStyle} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #f3f4f6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#111827', marginBottom: '6px' }}>
                Outreach logged ✓
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                background: isNew ? '#f0fdf4' : '#fffbeb',
                color: isNew ? '#166534' : '#92400e',
                border: `1px solid ${isNew ? '#bbf7d0' : '#fde68a'}`
              }}>
                {isNew ? <><CheckCircle size={12} /> New lead created</> : <><AlertTriangle size={12} /> Already in database</>}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: '2px' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Outreach</div>
            <div style={{ fontSize: '13px', color: '#374151', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <span>{OUTREACH_TYPE_LABELS[outreach?.outreach_type] || '—'}</span>
              <span style={{ color: '#9ca3af' }}>·</span>
              <span>{STATUS_LABELS[outreach?.status] || 'Sent'}</span>
              {outreach?.platform_details && <><span style={{ color: '#9ca3af' }}>·</span><span style={{ color: '#6b7280' }}>{outreach.platform_details}</span></>}
            </div>
          </div>

          {lead?.id ? (
            <>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Name</div>
                <input style={inputStyle} value={fv('name')} onChange={e => set('name', e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Firm</div>
                <input style={inputStyle} value={fv('firm_name')} onChange={e => set('firm_name', e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Industry</div>
                <select style={inputStyle} value={fv('industry')} onChange={e => set('industry', e.target.value)}>
                  <option value="">—</option>
                  {industryOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Deal Size</div>
                <select style={inputStyle} value={fv('deal_size')} onChange={e => set('deal_size', e.target.value)}>
                  <option value="">—</option>
                  {dealSizeOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Location</div>
                <select style={inputStyle} value={fv('location')} onChange={e => set('location', e.target.value)}>
                  <option value="">—</option>
                  {locationOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Lead Source</div>
                <select style={inputStyle} value={fv('lead_source')} onChange={e => set('lead_source', e.target.value)}>
                  <option value="">—</option>
                  {leadSourceOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Fit Score</div>
                <select style={inputStyle} value={fv('fit_score') || ''} onChange={e => set('fit_score', e.target.value ? parseInt(e.target.value) : null)}>
                  <option value="">—</option>
                  {[5,4,3,2,1].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              {lead.stage && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Stage</div>
                  <div style={{ fontSize: '13px', color: '#374151', padding: '7px 0' }}>{STAGE_LABELS[lead.stage] || lead.stage}</div>
                </div>
              )}
              {people.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Assign to</div>
                  <select style={inputStyle} value={fv('assigned_to') || ''} onChange={e => set('assigned_to', e.target.value ? parseInt(e.target.value) : null)}>
                    <option value="">— Unassigned</option>
                    {people.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.id === currentPersonId ? ' (me)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          ) : (
            <div style={{ gridColumn: '1 / -1', fontSize: '14px', color: '#374151' }}>
              <strong>{lead?.name}</strong>{lead?.firm_name ? ` · ${lead.firm_name}` : ''}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px 20px', display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid #f3f4f6' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Close</button>
          {dirty && (
            <button className="btn btn-primary" onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function CsvPreviewModal({ rows, skipped, importing, people = [], currentPersonId, industryOptions, dealSizeOptions, locationOptions, leadSourceOptions, onRowEdit, onImport, onClose }) {
  const [expandedIdx, setExpandedIdx] = useState(null)
  const dupeCount = rows.filter(r => r._dupe).length
  const newCount = rows.length - dupeCount
  const inputStyle = { width: '100%', padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: '5px', fontSize: '12px', background: 'white', boxSizing: 'border-box' }

  const fv = (row, k) => row._edits?.[k] !== undefined ? row._edits[k] : (row[k] ?? '')

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalBoxStyle, maxWidth: '740px' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #f3f4f6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#111827', marginBottom: '6px' }}>
                CSV Preview — {rows.length} row{rows.length !== 1 ? 's' : ''}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, padding: '3px 8px', borderRadius: '999px', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}>
                  {newCount} new
                </span>
                {dupeCount > 0 && (
                  <span style={{ fontSize: '12px', fontWeight: 600, padding: '3px 8px', borderRadius: '999px', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
                    {dupeCount} already in DB
                  </span>
                )}
                {skipped > 0 && (
                  <span style={{ fontSize: '12px', color: '#6b7280' }}>
                    {skipped} skipped (no name)
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: '2px' }} disabled={importing}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', maxHeight: 'calc(90vh - 140px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: '#374151', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Lead Name</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: '#374151', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Firm</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: '#374151', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Type</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: '#374151', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Fit</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: '#374151', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Status</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: '#374151', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}></th>
                <th style={{ padding: '10px 12px', width: '32px' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <>
                  <tr
                    key={idx}
                    style={{ borderBottom: expandedIdx === idx ? 'none' : '1px solid #f3f4f6', background: expandedIdx === idx ? '#f9fafb' : 'white', cursor: 'pointer' }}
                    onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                  >
                    <td style={{ padding: '10px 12px', fontWeight: 500, color: '#111827' }}>{fv(row, 'lead_name') || '—'}</td>
                    <td style={{ padding: '10px 12px', color: '#6b7280' }}>{fv(row, 'firm_name') || '—'}</td>
                    <td style={{ padding: '10px 12px', color: '#6b7280' }}>{OUTREACH_TYPE_LABELS[row.outreach_type] || '—'}</td>
                    <td style={{ padding: '10px 12px', color: '#6b7280' }}>{row.fit_score || '—'}</td>
                    <td style={{ padding: '10px 12px', color: '#6b7280' }}>{STATUS_LABELS[row.status] || '—'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {row._dupe ? (
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 7px', borderRadius: '999px', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <AlertTriangle size={10} /> In DB
                        </span>
                      ) : (
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 7px', borderRadius: '999px', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}>
                          New
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'center', color: '#9ca3af', fontSize: '10px' }}>
                      {expandedIdx === idx ? '▲' : '▼'}
                    </td>
                  </tr>
                  {expandedIdx === idx && (
                    <tr key={`${idx}-edit`} style={{ borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                      <td colSpan={7} style={{ padding: '0 12px 14px' }}>
                        {row._dupe && row._existingLead && (
                          <div style={{ marginBottom: '10px', fontSize: '12px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <AlertTriangle size={12} />
                            Matches existing lead: <strong>{row._existingLead.name}</strong>{row._existingLead.firm_name ? ` · ${row._existingLead.firm_name}` : ''}
                            {row._existingLead.stage ? ` · Stage: ${STAGE_LABELS[row._existingLead.stage] || row._existingLead.stage}` : ''}
                          </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                          <div><div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>Lead Name</div>
                            <input style={inputStyle} value={fv(row, 'lead_name')} onChange={e => onRowEdit(idx, 'lead_name', e.target.value)} /></div>
                          <div><div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>Firm</div>
                            <input style={inputStyle} value={fv(row, 'firm_name')} onChange={e => onRowEdit(idx, 'firm_name', e.target.value)} /></div>
                          <div><div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>Industry</div>
                            <select style={inputStyle} value={fv(row, 'industry')} onChange={e => onRowEdit(idx, 'industry', e.target.value)}>
                              <option value="">—</option>
                              {industryOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
                            </select></div>
                          <div><div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>Deal Size</div>
                            <select style={inputStyle} value={fv(row, 'deal_size')} onChange={e => onRowEdit(idx, 'deal_size', e.target.value)}>
                              <option value="">—</option>
                              {dealSizeOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
                            </select></div>
                          <div><div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>Location</div>
                            <select style={inputStyle} value={fv(row, 'location')} onChange={e => onRowEdit(idx, 'location', e.target.value)}>
                              <option value="">—</option>
                              {locationOptions.map(o => <option key={o.id} value={o.value}>{o.value}</option>)}
                            </select></div>
                          <div><div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>Fit Score</div>
                            <select style={inputStyle} value={fv(row, 'fit_score') || ''} onChange={e => onRowEdit(idx, 'fit_score', e.target.value ? parseInt(e.target.value) : null)}>
                              <option value="">—</option>
                              {[5,4,3,2,1].map(n => <option key={n} value={n}>{n}</option>)}
                            </select></div>
                          {people.length > 0 && (
                            <div><div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>Assign to</div>
                              <select style={inputStyle} value={fv(row, 'assigned_to') || ''} onChange={e => onRowEdit(idx, 'assigned_to', e.target.value ? parseInt(e.target.value) : null)}>
                                <option value="">— Unassigned</option>
                                {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === currentPersonId ? ' (me)' : ''}</option>)}
                              </select>
                            </div>
                          )}
                          <div style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>Notes</div>
                            <input style={inputStyle} value={fv(row, 'notes')} onChange={e => onRowEdit(idx, 'notes', e.target.value)} placeholder="Optional notes…" /></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={importing}>Cancel</button>
          <button className="btn btn-primary" onClick={onImport} disabled={importing}>
            {importing ? 'Importing…' : `Import ${rows.length} row${rows.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default OutreachTracker
