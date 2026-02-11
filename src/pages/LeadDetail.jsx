import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getLeadById, getLeadActivities, logActivity, updateLead, deleteLead, getLeadTranscripts, createTranscript, deleteTranscript, getTags, getLeadTags, addTagToLead, removeTagFromLead, calculateLeadScore, enrichLeadFromLinkedIn } from '../lib/crm-api'
import { useApp } from '../App'
import { ArrowLeft, Phone, Mail, Linkedin, Calendar, FileText, Trash2, Edit2, Save, X, TrendingUp, Tag, Sparkles } from 'lucide-react'

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
  const [allTags, setAllTags] = useState([])
  const [leadTags, setLeadTags] = useState([])
  const [enriching, setEnriching] = useState(false)
  const [calculating, setCalculating] = useState(false)

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    setLoading(true)
    try {
      const [leadData, activitiesData, transcriptsData, tagsData, leadTagsData] = await Promise.all([
        getLeadById(id),
        getLeadActivities(id),
        getLeadTranscripts(id),
        getTags(),
        getLeadTags(id)
      ])
      setLead(leadData)
      setEditedLead(leadData)
      setActivities(activitiesData)
      setTranscripts(transcriptsData)
      setAllTags(tagsData)
      setLeadTags(leadTagsData)
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

  async function handleCalculateScore() {
    setCalculating(true)
    try {
      const score = await calculateLeadScore(id)
      await loadData() // Refresh to get updated score
      alert(`Lead score calculated: ${score}/100`)
    } catch (error) {
      console.error('Failed to calculate score:', error)
      alert('Failed to calculate score')
    } finally {
      setCalculating(false)
    }
  }

  async function handleEnrichFromLinkedIn() {
    if (!editedLead.linkedin_url) {
      alert('Please add a LinkedIn URL first')
      return
    }

    setEnriching(true)
    try {
      const result = await enrichLeadFromLinkedIn(id, editedLead.linkedin_url)
      if (result.manual) {
        alert(result.message)
      }
      await loadData()
    } catch (error) {
      console.error('Failed to enrich:', error)
      alert('Failed to enrich from LinkedIn')
    } finally {
      setEnriching(false)
    }
  }

  async function handleAddTag(tagId) {
    try {
      await addTagToLead(id, tagId)
      await loadData()
    } catch (error) {
      console.error('Failed to add tag:', error)
      alert('Failed to add tag')
    }
  }

  async function handleRemoveTag(tagId) {
    try {
      await removeTagFromLead(id, tagId)
      await loadData()
    } catch (error) {
      console.error('Failed to remove tag:', error)
      alert('Failed to remove tag')
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

              {/* LinkedIn Enrichment Section */}
              <div className="form-group full-width" style={{ borderTop: '1px solid var(--gray-200)', paddingTop: '16px', marginTop: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={16} />
                  LinkedIn Auto-Enrichment
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
                    {enriching ? 'Enriching...' : 'Auto-Fill'}
                  </button>
                </div>
                {editedLead.linkedin_headline && (
                  <div style={{ marginTop: '8px', padding: '8px', background: 'var(--gray-50)', borderRadius: '4px', fontSize: '13px' }}>
                    {editedLead.linkedin_headline}
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
                      <div>{lead.trust_level.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</div>
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
              {(lead.current_role || lead.linkedin_headline || lead.education || lead.past_experience) && (
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

                  {lead.current_role && (
                    <div className="info-item">
                      <label>Current Role</label>
                      <div>{lead.current_role}</div>
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
