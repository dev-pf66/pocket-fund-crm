import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getLeadById, getLeadActivities, logActivity, updateLead, deleteLead, getLeadTranscripts, createTranscript, deleteTranscript, getTags, getLeadTags, addTagToLead, removeTagFromLead, calculateLeadScore, enrichLeadFromLinkedIn, assignLead, analyzeTranscript, getOutreachForLead, getDemosForLead } from '../lib/crm-api'
import { useApp } from '../App'
import { ArrowLeft, Phone, Mail, Linkedin, Calendar, FileText, Trash2, Edit2, Save, X, TrendingUp, Tag, Sparkles, UserCheck } from 'lucide-react'
import { useToast } from '../components/Toast'
import { useSessionState } from '../hooks/useSessionState'
import { useLeadTypes } from '../hooks/useLeadTypes'
import { istToday } from '../lib/dateUtils'

const today = istToday
const emptyActivity = () => ({ activity_type: 'call', notes: '', transcript: '', activity_date: today() })
const emptyTranscript = () => ({ title: '', transcript: '', call_date: today() })

// Click-to-edit field: renders value, clicks open an input, blur/Enter saves,
// Escape cancels. For multiline, use Cmd/Ctrl+Enter to save.
function InlineField({ value, onSave, type = 'text', options = null, placeholder = 'Click to add', multiline = false, renderValue = null, inputStyle = {} }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const savedRef = useRef(false)

  useEffect(() => {
    if (!editing) setDraft(value ?? '')
  }, [value, editing])

  async function commit() {
    if (savedRef.current) return
    savedRef.current = true
    const next = typeof draft === 'string' ? draft.trim() : draft
    const current = value ?? ''
    if (next === current) {
      setEditing(false)
      savedRef.current = false
      return
    }
    setSaving(true)
    try {
      await onSave(next)
      setEditing(false)
    } catch {
      setDraft(current)
    } finally {
      setSaving(false)
      savedRef.current = false
    }
  }

  function cancel() {
    setDraft(value ?? '')
    setEditing(false)
  }

  if (!editing) {
    const displayed = value
      ? (renderValue ? renderValue(value) : value)
      : <span className="inline-field-empty">{placeholder}</span>
    return (
      <div
        className="inline-field-display"
        onClick={() => setEditing(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(true) } }}
      >
        {displayed}
      </div>
    )
  }

  if (type === 'select') {
    return (
      <select
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Escape') cancel() }}
        disabled={saving}
        style={inputStyle}
      >
        {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    )
  }

  if (multiline) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
        }}
        disabled={saving}
        rows={3}
        style={inputStyle}
      />
    )
  }

  return (
    <input
      autoFocus
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel()
        if (e.key === 'Enter') commit()
      }}
      disabled={saving}
      style={inputStyle}
    />
  )
}

const STAGE_OPTIONS = [
  { value: 'new_lead', label: 'New Lead' },
  { value: 'cold_outreach', label: 'Cold Outreach' },
  { value: 'responded', label: 'Responded' },
  { value: 'warm_lead', label: 'Warm Lead' },
  { value: 'active_conversation', label: 'Active Conversation' },
  { value: 'meeting_booked', label: 'Meeting' },
  { value: 'client', label: 'Client' },
  { value: 'passed', label: 'Passed' }
]

function LeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { currentPerson, people } = useApp()
  const { toast } = useToast()
  const [lead, setLead] = useState(null)
  const [activities, setActivities] = useState([])
  const [transcripts, setTranscripts] = useState([])
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [editedLead, setEditedLead] = useState(null)
  const [showActivityForm, setShowActivityForm] = useSessionState(`ld:${id}:showActivityForm`, false)
  const [showTranscriptForm, setShowTranscriptForm] = useSessionState(`ld:${id}:showTranscriptForm`, false)
  const [newActivity, setNewActivity, clearNewActivity] = useSessionState(`ld:${id}:newActivity`, emptyActivity())
  const [newTranscript, setNewTranscript, clearNewTranscript] = useSessionState(`ld:${id}:newTranscript`, emptyTranscript())
  const [allTags, setAllTags] = useState([])
  const [leadTags, setLeadTags] = useState([])
  const [outreachHistory, setOutreachHistory] = useState([])
  const [demos, setDemos] = useState([])
  const [enriching, setEnriching] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [analysingTranscriptId, setAnalysingTranscriptId] = useState(null)

  const rawLeadTypes = useLeadTypes()
  const leadTypeOptions = [
    { value: '', label: 'Select type...' },
    ...rawLeadTypes.map(t => ({ value: t.name, label: t.name }))
  ]

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    setLoading(true)
    try {
      const [leadData, activitiesData, transcriptsData, tagsData, leadTagsData, outreachData, demosData] = await Promise.all([
        getLeadById(id),
        getLeadActivities(id),
        getLeadTranscripts(id),
        getTags(),
        getLeadTags(id),
        getOutreachForLead(id).catch(() => []),
        getDemosForLead(id).catch(() => [])
      ])
      setLead(leadData)
      setEditedLead(leadData)
      setActivities(activitiesData)
      setTranscripts(transcriptsData)
      setAllTags(tagsData)
      setLeadTags(leadTagsData)
      setOutreachHistory(outreachData)
      setDemos(demosData)
    } catch (error) {
      console.error('Failed to load lead:', error)
    } finally {
      setLoading(false)
    }
  }

  async function refreshLead() {
    const leadData = await getLeadById(id)
    setLead(leadData)
    setEditedLead(leadData)
  }

  async function refreshActivities() {
    const [leadData, activitiesData] = await Promise.all([
      getLeadById(id),
      getLeadActivities(id)
    ])
    setLead(leadData)
    setEditedLead(leadData)
    setActivities(activitiesData)
  }

  async function refreshTranscripts() {
    const transcriptsData = await getLeadTranscripts(id)
    setTranscripts(transcriptsData)
  }

  async function refreshTags() {
    const leadTagsData = await getLeadTags(id)
    setLeadTags(leadTagsData)
  }

  async function handleSave() {
    try {
      const updatedLead = await updateLead(id, editedLead, currentPerson?.id)
      setLead(updatedLead)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to update lead:', error)
      toast.error(`Failed to update lead: ${error.message}`)
    }
  }

  // Single-field save for inline editing. Updates local state optimistically,
  // rolls back on error.
  async function saveField(field, value) {
    const prev = lead[field]
    const normalized = value === '' ? null : value
    setLead(l => ({ ...l, [field]: normalized }))
    setEditedLead(l => ({ ...l, [field]: normalized }))
    try {
      await updateLead(id, { [field]: normalized }, currentPerson?.id)
    } catch (error) {
      console.error(`Failed to update ${field}:`, error)
      toast.error(`Failed to save: ${error.message}`)
      setLead(l => ({ ...l, [field]: prev }))
      setEditedLead(l => ({ ...l, [field]: prev }))
      throw error
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${lead.name}? This cannot be undone.`)) return

    try {
      await deleteLead(id)
      navigate('/pipeline')
    } catch (error) {
      console.error('Failed to delete lead:', error)
      toast.error('Failed to delete lead')
    }
  }

  async function handleAddActivity() {
    try {
      const { transcript, ...activityPayload } = newActivity
      await logActivity(id, activityPayload, currentPerson?.id)

      if (transcript?.trim()) {
        const saved = await createTranscript({
          lead_id: parseInt(id),
          title: `${newActivity.activity_type} — ${newActivity.activity_date}`,
          transcript,
          call_date: newActivity.activity_date,
          created_by: currentPerson?.id,
        })
        if (saved?.id) triggerAnalysis(saved.id, transcript)
      }

      clearNewActivity()
      setShowActivityForm(false)
      await refreshActivities()
      if (transcript?.trim()) await refreshTranscripts()
    } catch (error) {
      console.error('Failed to log activity:', error)
      toast.error(`Failed to log activity: ${error.message}`)
    }
  }

  async function handleAddTranscript() {
    try {
      const saved = await createTranscript({
        lead_id: parseInt(id),
        ...newTranscript,
        created_by: currentPerson?.id
      })
      clearNewTranscript()
      setShowTranscriptForm(false)
      await refreshTranscripts()

      // Auto-trigger AI analysis in the background
      if (saved?.id) {
        triggerAnalysis(saved.id, newTranscript.transcript)
      }
    } catch (error) {
      console.error('Failed to add transcript:', error)
      toast.error('Failed to add transcript')
    }
  }

  async function triggerAnalysis(transcriptId, transcriptText) {
    setAnalysingTranscriptId(transcriptId)
    try {
      await analyzeTranscript(transcriptId, transcriptText)
      await refreshTranscripts()
    } catch (error) {
      console.error('AI analysis failed:', error)
    } finally {
      setAnalysingTranscriptId(null)
    }
  }

  async function handleDeleteTranscript(transcriptId) {
    if (!confirm('Delete this transcript?')) return

    try {
      await deleteTranscript(transcriptId)
      await refreshTranscripts()
    } catch (error) {
      console.error('Failed to delete transcript:', error)
      toast.error('Failed to delete transcript')
    }
  }

  async function handleCalculateScore() {
    setCalculating(true)
    try {
      const score = await calculateLeadScore(id)
      await refreshLead()
      toast.success(`Lead score calculated: ${score}/100`)
    } catch (error) {
      console.error('Failed to calculate score:', error)
      toast.error('Failed to calculate score')
    } finally {
      setCalculating(false)
    }
  }

  async function handleEnrichFromLinkedIn() {
    if (!editedLead.linkedin_url) {
      toast.warn('Please add a LinkedIn URL first')
      return
    }

    setEnriching(true)
    try {
      await enrichLeadFromLinkedIn(id, editedLead.linkedin_url)
      await refreshLead()
    } catch (error) {
      console.error('Failed to enrich:', error)
      toast.error('Failed to enrich from LinkedIn: ' + error.message)
    } finally {
      setEnriching(false)
    }
  }

  async function handleAddTag(tagId) {
    try {
      await addTagToLead(id, tagId)
      await refreshTags()
    } catch (error) {
      console.error('Failed to add tag:', error)
      toast.error('Failed to add tag')
    }
  }

  async function handleRemoveTag(tagId) {
    try {
      await removeTagFromLead(id, tagId)
      await refreshTags()
    } catch (error) {
      console.error('Failed to remove tag:', error)
      toast.error('Failed to remove tag')
    }
  }

  async function handleAssignment(assignedToId) {
    try {
      const assignToPersonId = assignedToId ? parseInt(assignedToId) : null
      await assignLead(id, assignToPersonId, currentPerson?.id)
      await refreshLead()
    } catch (error) {
      console.error('Failed to assign lead:', error)
      toast.error('Failed to assign lead: ' + error.message)
    }
  }

  if (loading) {
    return <div className="loading">Loading lead...</div>
  }

  if (!lead) {
    return <div>Lead not found</div>
  }

  const activityTypeIcons = {
    call: <Phone size={16} />,
    email: <Mail size={16} />,
    linkedin_message: <Linkedin size={16} />,
    meeting: <Calendar size={16} />,
    sample_sent: <FileText size={16} />,
    proposal_sent: <FileText size={16} />,
    note: <FileText size={16} />
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link to="/pipeline" className="back-btn">
            <ArrowLeft size={20} />
          </Link>
          <h1>{lead.name}</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {!isEditing ? (
            <>
              <button className="btn btn-secondary" onClick={() => setIsEditing(true)} title="Edit firmographics, decision timeline, and relationship fields">
                <Edit2 size={16} />
                More Fields
              </button>
              <button className="btn btn-danger" onClick={handleDelete}>
                <Trash2 size={16} />
                Delete
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={() => {
                setIsEditing(false)
                setEditedLead(lead)
              }}>
                <X size={16} />
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                <Save size={16} />
                Save
              </button>
            </>
          )}
        </div>
      </div>

      <div className="lead-detail-grid">
        {/* Lead Info Card */}
        <div className="card">
          <h2>Lead Information</h2>

          {isEditing ? (
            <div className="form-grid">
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  value={editedLead.name}
                  onChange={(e) => setEditedLead({ ...editedLead, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Firm</label>
                <input
                  type="text"
                  value={editedLead.firm_name || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, firm_name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={editedLead.email || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, email: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Phone</label>
                <input
                  type="tel"
                  value={editedLead.phone || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, phone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>LinkedIn URL</label>
                <input
                  type="url"
                  value={editedLead.linkedin_url || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, linkedin_url: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Lead Type</label>
                <select
                  value={editedLead.lead_type || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, lead_type: e.target.value })}
                >
                  <option value="">Select type</option>
                  {rawLeadTypes.map(t => (
                    <option key={t.id} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group full-width">
                <label>Deal Criteria</label>
                <textarea
                  value={editedLead.deal_criteria || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, deal_criteria: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="form-group full-width">
                <label>Notes</label>
                <textarea
                  value={editedLead.notes || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, notes: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>Stage</label>
                <select
                  value={editedLead.stage}
                  onChange={(e) => setEditedLead({ ...editedLead, stage: e.target.value })}
                >
                  <option value="cold_outreach">Cold Outreach</option>
                  <option value="responded">Responded</option>
                  <option value="warm_lead">Warm Lead</option>
                  <option value="active_conversation">Active Conversation</option>
                  <option value="meeting_booked">Meeting</option>
                  <option value="client">Client</option>
                  <option value="passed">Passed</option>
                </select>
              </div>

              <div className="form-group">
                <label>Outreach Stage</label>
                <select
                  value={editedLead.outreach_stage || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, outreach_stage: e.target.value })}
                >
                  <option value="">Not set</option>
                  <option value="cold">Cold</option>
                  <option value="messaged">Messaged</option>
                  <option value="replied">Replied</option>
                  <option value="meeting">Meeting</option>
                </select>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <UserCheck size={16} />
                  Assigned To
                </label>
                <select
                  value={editedLead.assigned_to || ''}
                  onChange={(e) => handleAssignment(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {people.map(person => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={editedLead.needs_sample_deals || false}
                    onChange={(e) => setEditedLead({ ...editedLead, needs_sample_deals: e.target.checked })}
                  />
                  {' '}Needs Sample Deals
                </label>
              </div>

              {/* LinkedIn Enrichment Section */}
              <div className="form-group full-width" style={{ borderTop: '1px solid var(--gray-200)', paddingTop: '16px', marginTop: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={16} />
                  LinkedIn Auto-Enrichment
                  {editedLead.enrichment_status && (
                    <span className={`enrichment-badge enrichment-badge-${editedLead.enrichment_status}`}>
                      {editedLead.enrichment_status}
                    </span>
                  )}
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
                  <input
                    type="url"
                    value={editedLead.linkedin_url || ''}
                    onChange={(e) => setEditedLead({ ...editedLead, linkedin_url: e.target.value })}
                    placeholder="Paste LinkedIn URL..."
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={handleEnrichFromLinkedIn}
                    disabled={!editedLead.linkedin_url || enriching}
                  >
                    {enriching && <span className="enrichment-spinner" />}
                    {enriching ? 'Enriching...' : editedLead.enrichment_status === 'enriched' ? 'Re-enrich' : 'Auto-Fill'}
                  </button>
                </div>

                {/* Enrichment results */}
                {editedLead.enrichment_status === 'enriched' && (
                  <div className="enrichment-results">
                    {editedLead.linkedin_headline && (
                      <div className="enrichment-field">
                        <span className="enrichment-field-label">Headline</span>
                        <span className="enrichment-field-value">{editedLead.linkedin_headline}</span>
                      </div>
                    )}
                    {editedLead.current_position && (
                      <div className="enrichment-field">
                        <span className="enrichment-field-label">Current Role</span>
                        <span className="enrichment-field-value">{editedLead.current_position}</span>
                      </div>
                    )}
                    {editedLead.education && (
                      <div className="enrichment-field">
                        <span className="enrichment-field-label">Education</span>
                        <span className="enrichment-field-value">{editedLead.education}</span>
                      </div>
                    )}
                    {editedLead.past_experience && (
                      <div className="enrichment-field">
                        <span className="enrichment-field-label">Past Experience</span>
                        <span className="enrichment-field-value enrichment-field-pre">{editedLead.past_experience}</span>
                      </div>
                    )}
                    {editedLead.enriched_at && (
                      <div className="enrichment-timestamp">
                        Enriched {new Date(editedLead.enriched_at).toLocaleDateString()} via AI
                      </div>
                    )}
                  </div>
                )}

                {editedLead.enrichment_status === 'failed' && (
                  <div className="enrichment-failed">
                    Enrichment failed. Check the LinkedIn URL and try again.
                  </div>
                )}

                {enriching && (
                  <div className="enrichment-loading">
                    <span className="enrichment-spinner" />
                    Analyzing LinkedIn profile with AI...
                  </div>
                )}
              </div>

              {/* Firmographics Section */}
              <div className="form-group full-width" style={{ borderTop: '1px solid var(--gray-200)', paddingTop: '16px', marginTop: '16px' }}>
                <h3 style={{ marginBottom: '12px', fontSize: '16px', color: 'var(--gray-700)' }}>Firmographics</h3>
              </div>

              <div className="form-group">
                <label>AUM</label>
                <input
                  type="text"
                  value={editedLead.aum || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, aum: e.target.value })}
                  placeholder="e.g., $50M-$100M"
                />
              </div>

              <div className="form-group">
                <label>Portfolio Size</label>
                <input
                  type="number"
                  value={editedLead.portfolio_size || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, portfolio_size: parseInt(e.target.value) || null })}
                  placeholder="# of companies"
                />
              </div>

              <div className="form-group">
                <label>Fund Vintage</label>
                <input
                  type="text"
                  value={editedLead.fund_vintage || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, fund_vintage: e.target.value })}
                  placeholder="e.g., 2022"
                />
              </div>

              <div className="form-group full-width">
                <label>Investment Thesis</label>
                <textarea
                  value={editedLead.investment_thesis || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, investment_thesis: e.target.value })}
                  rows={2}
                  placeholder="What types of deals are they looking for?"
                />
              </div>

              <div className="form-group full-width">
                <label>Recent Deals</label>
                <textarea
                  value={editedLead.recent_deals || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, recent_deals: e.target.value })}
                  rows={2}
                  placeholder="Notable recent acquisitions or investments"
                />
              </div>

              {/* Decision Timeline Section */}
              <div className="form-group full-width" style={{ borderTop: '1px solid var(--gray-200)', paddingTop: '16px', marginTop: '16px' }}>
                <h3 style={{ marginBottom: '12px', fontSize: '16px', color: 'var(--gray-700)' }}>Decision Timeline</h3>
              </div>

              <div className="form-group">
                <label>Expected Close Date</label>
                <input
                  type="date"
                  value={editedLead.expected_close_date || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, expected_close_date: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Budget Discussed</label>
                <input
                  type="text"
                  value={editedLead.budget_discussed || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, budget_discussed: e.target.value })}
                  placeholder="e.g., $5K-10K/month"
                />
              </div>

              <div className="form-group">
                <label>Decision Process Stage</label>
                <select
                  value={editedLead.decision_process_stage || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, decision_process_stage: e.target.value })}
                >
                  <option value="">Select stage</option>
                  <option value="Evaluation">Evaluation</option>
                  <option value="Approval">Approval</option>
                  <option value="Legal Review">Legal Review</option>
                  <option value="Contracting">Contracting</option>
                  <option value="Ready to Sign">Ready to Sign</option>
                </select>
              </div>

              <div className="form-group full-width">
                <label>Key Blockers</label>
                <textarea
                  value={editedLead.key_blockers || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, key_blockers: e.target.value })}
                  rows={2}
                  placeholder="What's preventing them from closing?"
                />
              </div>

              {/* Relationship Strength Section */}
              <div className="form-group full-width" style={{ borderTop: '1px solid var(--gray-200)', paddingTop: '16px', marginTop: '16px' }}>
                <h3 style={{ marginBottom: '12px', fontSize: '16px', color: 'var(--gray-700)' }}>Relationship Strength</h3>
              </div>

              <div className="form-group">
                <label>Relationship Strength</label>
                <select
                  value={editedLead.relationship_strength || 'cold'}
                  onChange={(e) => setEditedLead({ ...editedLead, relationship_strength: e.target.value })}
                >
                  <option value="cold">Cold</option>
                  <option value="warm">Warm</option>
                  <option value="strong">Strong</option>
                </select>
              </div>

              <div className="form-group">
                <label>Trust Level</label>
                <select
                  value={editedLead.trust_level || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, trust_level: e.target.value })}
                >
                  <option value="">Select level</option>
                  <option value="building">Building</option>
                  <option value="established">Established</option>
                  <option value="trusted_advisor">Trusted Advisor</option>
                </select>
              </div>

              <div className="form-group full-width">
                <label>Mutual Connections</label>
                <textarea
                  value={editedLead.mutual_connections || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, mutual_connections: e.target.value })}
                  rows={2}
                  placeholder="Who do we both know?"
                />
              </div>

              <div className="form-group full-width">
                <label>Referral Details</label>
                <textarea
                  value={editedLead.referral_details || ''}
                  onChange={(e) => setEditedLead({ ...editedLead, referral_details: e.target.value })}
                  rows={2}
                  placeholder="How were we introduced?"
                />
              </div>
            </div>
          ) : (
            <div className="info-grid">
              <div className="info-item">
                <label>Firm</label>
                <InlineField value={lead.firm_name} onSave={(v) => saveField('firm_name', v)} placeholder="Click to add firm" />
              </div>

              <div className="info-item">
                <label>Email</label>
                <InlineField
                  value={lead.email}
                  onSave={(v) => saveField('email', v)}
                  type="email"
                  placeholder="Click to add email"
                  renderValue={(v) => <a href={`mailto:${v}`} onClick={(e) => e.stopPropagation()}>{v}</a>}
                />
              </div>

              <div className="info-item">
                <label>Phone</label>
                <InlineField
                  value={lead.phone}
                  onSave={(v) => saveField('phone', v)}
                  type="tel"
                  placeholder="Click to add phone"
                  renderValue={(v) => <a href={`tel:${v}`} onClick={(e) => e.stopPropagation()}>{v}</a>}
                />
              </div>

              <div className="info-item">
                <label>LinkedIn</label>
                <InlineField
                  value={lead.linkedin_url}
                  onSave={(v) => saveField('linkedin_url', v)}
                  type="url"
                  placeholder="Click to add LinkedIn"
                  renderValue={(v) => <a href={v} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>View Profile</a>}
                />
              </div>

              <div className="info-item">
                <label>Lead Type</label>
                <InlineField
                  value={lead.lead_type || ''}
                  onSave={(v) => saveField('lead_type', v)}
                  type="select"
                  options={leadTypeOptions}
                  placeholder="Click to set type"
                  renderValue={(v) => <span className="lead-type-badge">{v}</span>}
                />
              </div>

              <div className="info-item">
                <label>Stage</label>
                <InlineField
                  value={lead.stage}
                  onSave={(v) => saveField('stage', v)}
                  type="select"
                  options={STAGE_OPTIONS}
                  renderValue={(v) => v.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                />
              </div>

              <div className="info-item">
                <label>Outreach Stage</label>
                <InlineField
                  value={lead.outreach_stage || ''}
                  onSave={(v) => saveField('outreach_stage', v)}
                  type="select"
                  options={[
                    { value: '',         label: 'Not set' },
                    { value: 'cold',     label: 'Cold' },
                    { value: 'messaged', label: 'Messaged' },
                    { value: 'replied',  label: 'Replied' },
                    { value: 'meeting',  label: 'Meeting' },
                  ]}
                  placeholder="Click to set"
                  renderValue={(v) => <span className="stage-badge">{v.charAt(0).toUpperCase() + v.slice(1)}</span>}
                />
              </div>

              <div className="info-item">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <UserCheck size={16} />
                  Assigned To
                </label>
                <InlineField
                  value={lead.assigned_to ? String(lead.assigned_to) : ''}
                  onSave={(v) => handleAssignment(v)}
                  type="select"
                  options={[{ value: '', label: 'Unassigned' }, ...people.map(p => ({ value: String(p.id), label: p.name }))]}
                  placeholder="Click to assign"
                  renderValue={(v) => {
                    const person = people.find(p => p.id === parseInt(v))
                    return person ? person.name : 'Unknown'
                  }}
                />
                {lead.assigned_date && (
                  <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginTop: '4px' }}>
                    Assigned {new Date(lead.assigned_date).toLocaleDateString()}
                  </div>
                )}
              </div>

              <div className="info-item full-width">
                <label>Deal Criteria</label>
                <InlineField
                  value={lead.deal_criteria}
                  onSave={(v) => saveField('deal_criteria', v)}
                  multiline
                  placeholder="Click to add deal criteria (Cmd+Enter to save)"
                />
              </div>

              <div className="info-item full-width">
                <label>Notes</label>
                <InlineField
                  value={lead.notes}
                  onSave={(v) => saveField('notes', v)}
                  multiline
                  placeholder="Click to add notes (Cmd+Enter to save)"
                  renderValue={(v) => <span style={{ whiteSpace: 'pre-wrap' }}>{v}</span>}
                />
              </div>

              {lead.needs_sample_deals && (
                <div className="info-item">
                  <div className="lead-flag">📋 Needs Sample Deals</div>
                </div>
              )}

              {/* Lead Score */}
              {lead.lead_score !== null && lead.lead_score !== undefined && (
                <div className="info-item full-width" style={{ borderTop: '1px solid var(--gray-200)', paddingTop: '16px', marginTop: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <TrendingUp size={16} />
                    Lead Score
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
                    <div style={{
                      fontSize: '32px',
                      fontWeight: 'bold',
                      color: lead.lead_score >= 75 ? 'var(--success)' : lead.lead_score >= 50 ? 'var(--warning)' : 'var(--gray-500)'
                    }}>
                      {lead.lead_score}
                      <span style={{ fontSize: '18px', color: 'var(--gray-400)' }}>/100</span>
                    </div>
                    <button className="btn btn-sm btn-secondary" onClick={handleCalculateScore} disabled={calculating}>
                      {calculating ? 'Calculating...' : 'Recalculate'}
                    </button>
                  </div>
                  {lead.score_last_calculated && (
                    <div style={{ fontSize: '13px', color: 'var(--gray-500)', marginTop: '4px' }}>
                      Last calculated: {new Date(lead.score_last_calculated).toLocaleString()}
                    </div>
                  )}
                </div>
              )}

              {/* Firmographics */}
              {(lead.aum || lead.investment_thesis || lead.portfolio_size || lead.fund_vintage || lead.recent_deals) && (
                <>
                  <div className="info-item full-width" style={{ borderTop: '1px solid var(--gray-200)', paddingTop: '16px', marginTop: '16px' }}>
                    <h3 style={{ fontSize: '16px', color: 'var(--gray-700)', margin: 0 }}>Firmographics</h3>
                  </div>

                  {lead.aum && (
                    <div className="info-item">
                      <label>AUM</label>
                      <div>{lead.aum}</div>
                    </div>
                  )}

                  {lead.portfolio_size && (
                    <div className="info-item">
                      <label>Portfolio Size</label>
                      <div>{lead.portfolio_size} companies</div>
                    </div>
                  )}

                  {lead.fund_vintage && (
                    <div className="info-item">
                      <label>Fund Vintage</label>
                      <div>{lead.fund_vintage}</div>
                    </div>
                  )}

                  {lead.investment_thesis && (
                    <div className="info-item full-width">
                      <label>Investment Thesis</label>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{lead.investment_thesis}</div>
                    </div>
                  )}

                  {lead.recent_deals && (
                    <div className="info-item full-width">
                      <label>Recent Deals</label>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{lead.recent_deals}</div>
                    </div>
                  )}
                </>
              )}

              {/* Decision Timeline */}
              {(lead.expected_close_date || lead.budget_discussed || lead.decision_process_stage || lead.key_blockers) && (
                <>
                  <div className="info-item full-width" style={{ borderTop: '1px solid var(--gray-200)', paddingTop: '16px', marginTop: '16px' }}>
                    <h3 style={{ fontSize: '16px', color: 'var(--gray-700)', margin: 0 }}>Decision Timeline</h3>
                  </div>

                  {lead.expected_close_date && (
                    <div className="info-item">
                      <label>Expected Close Date</label>
                      <div>{new Date(lead.expected_close_date).toLocaleDateString()}</div>
                    </div>
                  )}

                  {lead.budget_discussed && (
                    <div className="info-item">
                      <label>Budget Discussed</label>
                      <div>{lead.budget_discussed}</div>
                    </div>
                  )}

                  {lead.decision_process_stage && (
                    <div className="info-item">
                      <label>Decision Process Stage</label>
                      <div><span className="stage-badge">{lead.decision_process_stage}</span></div>
                    </div>
                  )}

                  {lead.key_blockers && (
                    <div className="info-item full-width">
                      <label>Key Blockers</label>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{lead.key_blockers}</div>
                    </div>
                  )}
                </>
              )}

              {/* Relationship Strength */}
              {(lead.relationship_strength || lead.trust_level || lead.mutual_connections || lead.referral_details) && (
                <>
                  <div className="info-item full-width" style={{ borderTop: '1px solid var(--gray-200)', paddingTop: '16px', marginTop: '16px' }}>
                    <h3 style={{ fontSize: '16px', color: 'var(--gray-700)', margin: 0 }}>Relationship Strength</h3>
                  </div>

                  {lead.relationship_strength && (
                    <div className="info-item">
                      <label>Relationship</label>
                      <div><span className={`relationship-badge ${lead.relationship_strength}`}>{lead.relationship_strength}</span></div>
                    </div>
                  )}

                  {lead.trust_level && (
                    <div className="info-item">
                      <label>Trust Level</label>
                      <div>{lead.trust_level.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</div>
                    </div>
                  )}

                  {lead.mutual_connections && (
                    <div className="info-item full-width">
                      <label>Mutual Connections</label>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{lead.mutual_connections}</div>
                    </div>
                  )}

                  {lead.referral_details && (
                    <div className="info-item full-width">
                      <label>Referral Details</label>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{lead.referral_details}</div>
                    </div>
                  )}
                </>
              )}

              {/* LinkedIn Enrichment Info */}
              {(lead.current_position || lead.linkedin_headline || lead.education || lead.past_experience) && (
                <>
                  <div className="info-item full-width" style={{ borderTop: '1px solid var(--gray-200)', paddingTop: '16px', marginTop: '16px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Linkedin size={16} />
                      LinkedIn Profile
                    </label>
                  </div>

                  {lead.linkedin_headline && (
                    <div className="info-item full-width">
                      <div style={{ fontStyle: 'italic', color: 'var(--gray-600)' }}>{lead.linkedin_headline}</div>
                    </div>
                  )}

                  {lead.current_position && (
                    <div className="info-item">
                      <label>Current Position</label>
                      <div>{lead.current_position}</div>
                    </div>
                  )}

                  {lead.education && (
                    <div className="info-item">
                      <label>Education</label>
                      <div>{lead.education}</div>
                    </div>
                  )}

                  {lead.past_experience && (
                    <div className="info-item full-width">
                      <label>Past Experience</label>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{lead.past_experience}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Tags Card */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Tag size={20} />
              Tags
            </h2>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            {leadTags.length === 0 && (
              <div style={{ color: 'var(--gray-400)', fontSize: '14px' }}>No tags yet</div>
            )}
            {leadTags.map(tag => (
              <div
                key={tag.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 12px',
                  background: tag.color || '#3b82f6',
                  color: 'white',
                  borderRadius: '16px',
                  fontSize: '13px',
                  fontWeight: '500'
                }}
              >
                {tag.name}
                <button
                  onClick={() => handleRemoveTag(tag.id)}
                  style={{
                    background: 'rgba(255,255,255,0.3)',
                    border: 'none',
                    borderRadius: '50%',
                    width: '18px',
                    height: '18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    padding: 0
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '600' }}>Add Tag</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {allTags.filter(tag => !leadTags.find(lt => lt.id === tag.id)).map(tag => (
                <button
                  key={tag.id}
                  onClick={() => handleAddTag(tag.id)}
                  style={{
                    padding: '4px 12px',
                    background: 'white',
                    border: `2px solid ${tag.color || '#3b82f6'}`,
                    color: tag.color || '#3b82f6',
                    borderRadius: '16px',
                    fontSize: '13px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => {
                    e.target.style.background = tag.color || '#3b82f6'
                    e.target.style.color = 'white'
                  }}
                  onMouseOut={(e) => {
                    e.target.style.background = 'white'
                    e.target.style.color = tag.color || '#3b82f6'
                  }}
                >
                  + {tag.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Outreach History — every logged touch on this person, so the
            person-hub actually shows the outreach → reply journey. */}
        {outreachHistory.length > 0 && (
          <div className="card">
            <h2 style={{ marginBottom: '12px' }}>Outreach History <span style={{ fontSize: '13px', fontWeight: 500, color: '#6b7280' }}>({outreachHistory.length})</span></h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {outreachHistory.map(o => (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px', color: '#6b7280', fontVariantNumeric: 'tabular-nums', minWidth: '84px' }}>{o.outreach_date}</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>{(o.outreach_type || '').replace(/_/g, ' ')}</span>
                  <span style={{
                    fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px',
                    background: o.status === 'replied' ? '#f0fdf4' : o.status === 'bounced' ? '#fef2f2' : '#f3f4f6',
                    color: o.status === 'replied' ? '#166534' : o.status === 'bounced' ? '#991b1b' : '#6b7280'
                  }}>
                    {(o.status || 'sent').replace(/_/g, ' ')}
                  </span>
                  {o.logged_by_person?.name && (
                    <span style={{ fontSize: '12px', color: '#9ca3af' }}>by {o.logged_by_person.name}</span>
                  )}
                  {o.message_content && (
                    <span style={{ fontSize: '12px', color: '#6b7280', flex: '1 1 100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.message_content}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PE OS Demos with this person */}
        {demos.length > 0 && (
          <div className="card">
            <h2 style={{ marginBottom: '12px' }}>PE OS Demos <span style={{ fontSize: '13px', fontWeight: 500, color: '#6b7280' }}>({demos.length})</span></h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {demos.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px', color: '#6b7280', fontVariantNumeric: 'tabular-nums', minWidth: '84px' }}>{d.demo_date || 'unscheduled'}</span>
                  <span style={{
                    fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px',
                    background: d.stage === 'signed_up' ? '#f0fdf4' : d.stage === 'passed' ? '#fef2f2' : '#eff6ff',
                    color: d.stage === 'signed_up' ? '#166534' : d.stage === 'passed' ? '#991b1b' : '#1e40af'
                  }}>
                    {(d.stage || '').replace(/_/g, ' ')}
                  </span>
                  {d.use_case && <span style={{ fontSize: '12px', color: '#6b7280' }}>{d.use_case}</span>}
                  {d.next_steps && <span style={{ fontSize: '12px', color: '#6b7280' }}>→ {d.next_steps}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Activity Timeline */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2>Activity Timeline</h2>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => setShowActivityForm(!showActivityForm)}
            >
              {showActivityForm ? 'Cancel' : '+ Log Activity'}
            </button>
          </div>

          {showActivityForm && (
            <div className="activity-form">
              <div className="form-group">
                <label>Activity Type</label>
                <select
                  value={newActivity.activity_type}
                  onChange={(e) => setNewActivity({ ...newActivity, activity_type: e.target.value })}
                >
                  <option value="call">Phone Call</option>
                  <option value="email">Email</option>
                  <option value="linkedin_message">LinkedIn Message</option>
                  <option value="meeting">Meeting</option>
                  <option value="sample_sent">Sample Deals Sent</option>
                  <option value="proposal_sent">Proposal Sent</option>
                  <option value="note">Note</option>
                </select>
              </div>

              <div className="form-group">
                <label>Notes</label>
                <textarea
                  value={newActivity.notes}
                  onChange={(e) => setNewActivity({ ...newActivity, notes: e.target.value })}
                  placeholder="What happened?"
                  rows={3}
                />
              </div>

              {(newActivity.activity_type === 'call' || newActivity.activity_type === 'meeting') && (
                <div className="form-group">
                  <label>Call Transcript (Optional)</label>
                  <textarea
                    value={newActivity.transcript}
                    onChange={(e) => setNewActivity({ ...newActivity, transcript: e.target.value })}
                    placeholder="Paste full call transcript here..."
                    rows={8}
                    style={{ fontFamily: 'monospace', fontSize: '13px' }}
                  />
                </div>
              )}

              <button className="btn btn-primary" onClick={handleAddActivity}>
                Log Activity
              </button>
            </div>
          )}

          <div className="activity-timeline">
            {activities.length === 0 && (
              <div className="empty-state">No activities yet</div>
            )}

            {activities.map((activity) => (
              <div key={activity.id} className="activity-item">
                <div className="activity-icon">
                  {activityTypeIcons[activity.activity_type] || <FileText size={16} />}
                </div>
                <div className="activity-content">
                  <div className="activity-header">
                    <strong>{activity.activity_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</strong>
                    <span className="activity-date">
                      {new Date(activity.activity_date).toLocaleString()}
                    </span>
                  </div>
                  {activity.notes && (
                    <div className="activity-notes">{activity.notes}</div>
                  )}
                  {activity.transcript && (
                    <details className="activity-transcript" style={{ marginTop: '12px' }}>
                      <summary style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: '600', marginBottom: '8px' }}>
                        📝 View Call Transcript
                      </summary>
                      <div style={{
                        background: 'var(--gray-50)',
                        padding: '16px',
                        borderRadius: '8px',
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'monospace',
                        fontSize: '13px',
                        lineHeight: '1.6',
                        color: 'var(--gray-700)',
                        maxHeight: '400px',
                        overflowY: 'auto'
                      }}>
                        {activity.transcript}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Call Transcripts */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2><Phone size={20} /> Call Transcripts</h2>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => setShowTranscriptForm(!showTranscriptForm)}
            >
              {showTranscriptForm ? 'Cancel' : '+ Add Transcript'}
            </button>
          </div>

          {showTranscriptForm && (
            <div className="activity-form" style={{ marginBottom: '24px' }}>
              <div className="form-group">
                <label>Title (Optional)</label>
                <input
                  type="text"
                  value={newTranscript.title}
                  onChange={(e) => setNewTranscript({ ...newTranscript, title: e.target.value })}
                  placeholder="e.g., Discovery Call - Feb 10"
                />
              </div>

              <div className="form-group">
                <label>Call Date</label>
                <input
                  type="date"
                  value={newTranscript.call_date}
                  onChange={(e) => setNewTranscript({ ...newTranscript, call_date: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Transcript *</label>
                <textarea
                  value={newTranscript.transcript}
                  onChange={(e) => setNewTranscript({ ...newTranscript, transcript: e.target.value })}
                  placeholder="Paste full call transcript here..."
                  rows={10}
                  style={{ fontFamily: 'monospace', fontSize: '13px' }}
                />
              </div>

              <button
                className="btn btn-primary"
                onClick={handleAddTranscript}
                disabled={!newTranscript.transcript}
              >
                Save Transcript
              </button>
            </div>
          )}

          <div className="transcripts-list">
            {transcripts.length === 0 && !showTranscriptForm && (
              <div className="empty-state">No transcripts yet</div>
            )}

            {transcripts.map((transcript) => (
              <div key={transcript.id} className="transcript-item">
                <div className="transcript-header">
                  <div>
                    <h4>{transcript.title || `Call - ${new Date(transcript.call_date).toLocaleDateString()}`}</h4>
                    <span className="transcript-date">
                      {new Date(transcript.call_date).toLocaleDateString('en-US', {
                        weekday: 'short',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {!transcript.ai_analysis && analysingTranscriptId !== transcript.id && (
                      <button
                        className="btn btn-sm"
                        style={{ fontSize: '12px' }}
                        onClick={() => triggerAnalysis(transcript.id, transcript.transcript)}
                        title="Analyse with AI"
                      >
                        <Sparkles size={14} /> Analyse
                      </button>
                    )}
                    {analysingTranscriptId === transcript.id && (
                      <span style={{ fontSize: '12px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span className="loading-spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></span>
                        Analysing…
                      </span>
                    )}
                    {transcript.ai_analysis && (
                      <button
                        className="btn btn-sm"
                        style={{ fontSize: '12px' }}
                        onClick={() => triggerAnalysis(transcript.id, transcript.transcript)}
                        title="Re-analyse"
                      >
                        <Sparkles size={14} /> Re-analyse
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      onClick={() => handleDeleteTranscript(transcript.id)}
                      title="Delete transcript"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="transcript-content">
                  {transcript.transcript}
                </div>

                {/* AI Analysis Panel */}
                {transcript.ai_analysis && (
                  <div className="ai-analysis-panel">
                    <div className="ai-analysis-header">
                      <Sparkles size={14} />
                      <span>AI Analysis</span>
                      {transcript.ai_analysis.analysed_at && (
                        <span style={{ fontSize: '11px', color: '#9ca3af', marginLeft: 'auto' }}>
                          {new Date(transcript.ai_analysis.analysed_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    <p style={{ margin: '0 0 12px', fontSize: '14px', lineHeight: '1.6', color: '#374151' }}>
                      {transcript.ai_analysis.summary}
                    </p>

                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px', alignItems: 'center' }}>
                      {/* Sentiment badge */}
                      <span className={`ai-sentiment ai-sentiment--${(transcript.ai_analysis.sentiment || 'Neutral').toLowerCase()}`}>
                        {transcript.ai_analysis.sentiment}
                      </span>

                      {/* Fit score stars */}
                      <span style={{ fontSize: '13px', color: '#6b7280' }}>
                        Fit:{' '}
                        {Array.from({ length: 5 }, (_, i) => (
                          <span key={i} style={{ color: i < transcript.ai_analysis.fit_score ? '#f59e0b' : '#d1d5db' }}>★</span>
                        ))}
                        {' '}<span style={{ color: '#6b7280' }}>({transcript.ai_analysis.fit_reasoning})</span>
                      </span>
                    </div>

                    {/* Next step callout */}
                    <div className="ai-next-step">
                      <strong>Next step:</strong> {transcript.ai_analysis.next_step}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default LeadDetail
