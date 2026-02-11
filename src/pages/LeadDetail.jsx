import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getLeadById, getLeadActivities, logActivity, updateLead, deleteLead, getLeadTranscripts, createTranscript, deleteTranscript } from '../lib/crm-api'
import { useApp } from '../App'
import { ArrowLeft, Phone, Mail, Linkedin, Calendar, FileText, Trash2, Edit2, Save, X } from 'lucide-react'

function LeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { currentPerson } = useApp()
  const [lead, setLead] = useState(null)
  const [activities, setActivities] = useState([])
  const [transcripts, setTranscripts] = useState([])
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [editedLead, setEditedLead] = useState(null)
  const [showActivityForm, setShowActivityForm] = useState(false)
  const [showTranscriptForm, setShowTranscriptForm] = useState(false)
  const [newActivity, setNewActivity] = useState({ activity_type: 'call', notes: '', transcript: '' })
  const [newTranscript, setNewTranscript] = useState({ title: '', transcript: '', call_date: new Date().toISOString().split('T')[0] })

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    setLoading(true)
    try {
      const [leadData, activitiesData, transcriptsData] = await Promise.all([
        getLeadById(id),
        getLeadActivities(id),
        getLeadTranscripts(id)
      ])
      setLead(leadData)
      setEditedLead(leadData)
      setActivities(activitiesData)
      setTranscripts(transcriptsData)
    } catch (error) {
      console.error('Failed to load lead:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    try {
      await updateLead(id, editedLead)
      setLead(editedLead)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to update lead:', error)
      alert('Failed to update lead')
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${lead.name}? This cannot be undone.`)) return

    try {
      await deleteLead(id)
      navigate('/pipeline')
    } catch (error) {
      console.error('Failed to delete lead:', error)
      alert('Failed to delete lead')
    }
  }

  async function handleAddActivity() {
    try {
      await logActivity(id, newActivity, currentPerson?.id)
      setNewActivity({ activity_type: 'call', notes: '', transcript: '' })
      setShowActivityForm(false)
      await loadData()
    } catch (error) {
      console.error('Failed to log activity:', error)
      alert('Failed to log activity')
    }
  }

  async function handleAddTranscript() {
    try {
      await createTranscript({
        lead_id: parseInt(id),
        ...newTranscript,
        created_by: currentPerson?.id
      })
      setNewTranscript({ title: '', transcript: '', call_date: new Date().toISOString().split('T')[0] })
      setShowTranscriptForm(false)
      await loadData()
    } catch (error) {
      console.error('Failed to add transcript:', error)
      alert('Failed to add transcript')
    }
  }

  async function handleDeleteTranscript(transcriptId) {
    if (!confirm('Delete this transcript?')) return

    try {
      await deleteTranscript(transcriptId)
      await loadData()
    } catch (error) {
      console.error('Failed to delete transcript:', error)
      alert('Failed to delete transcript')
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
              <button className="btn btn-secondary" onClick={() => setIsEditing(true)}>
                <Edit2 size={16} />
                Edit
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
                  <option value="PE Firm">PE Firm</option>
                  <option value="Family Office">Family Office</option>
                  <option value="Independent Sponsor">Independent Sponsor</option>
                  <option value="Other">Other</option>
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
                  <option value="warm_lead">Warm Lead</option>
                  <option value="active_conversation">Active Conversation</option>
                  <option value="client">Client</option>
                  <option value="passed">Passed</option>
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
            </div>
          ) : (
            <div className="info-grid">
              {lead.firm_name && (
                <div className="info-item">
                  <label>Firm</label>
                  <div>{lead.firm_name}</div>
                </div>
              )}

              {lead.email && (
                <div className="info-item">
                  <label>Email</label>
                  <div><a href={`mailto:${lead.email}`}>{lead.email}</a></div>
                </div>
              )}

              {lead.phone && (
                <div className="info-item">
                  <label>Phone</label>
                  <div><a href={`tel:${lead.phone}`}>{lead.phone}</a></div>
                </div>
              )}

              {lead.linkedin_url && (
                <div className="info-item">
                  <label>LinkedIn</label>
                  <div><a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer">View Profile</a></div>
                </div>
              )}

              {lead.lead_type && (
                <div className="info-item">
                  <label>Lead Type</label>
                  <div><span className="lead-type-badge">{lead.lead_type}</span></div>
                </div>
              )}

              <div className="info-item">
                <label>Stage</label>
                <div>{lead.stage.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</div>
              </div>

              {lead.deal_criteria && (
                <div className="info-item full-width">
                  <label>Deal Criteria</label>
                  <div>{lead.deal_criteria}</div>
                </div>
              )}

              {lead.notes && (
                <div className="info-item full-width">
                  <label>Notes</label>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{lead.notes}</div>
                </div>
              )}

              {lead.needs_sample_deals && (
                <div className="info-item">
                  <div className="lead-flag">📋 Needs Sample Deals</div>
                </div>
              )}
            </div>
          )}
        </div>

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
                    <strong>{activity.activity_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</strong>
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
                  <button
                    className="icon-btn"
                    onClick={() => handleDeleteTranscript(transcript.id)}
                    title="Delete transcript"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="transcript-content">
                  {transcript.transcript}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default LeadDetail
