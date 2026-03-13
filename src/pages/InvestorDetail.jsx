import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getInvestorById, getInvestorInteractions, logInvestorInteraction, updateInvestor, deleteInvestor, deleteInvestorInteraction } from '../lib/crm-api'
import { useApp } from '../App'
import { ArrowLeft, Phone, Mail, Linkedin, Calendar, Trash2, Edit2, Save, X, MessageSquare, Users, Handshake, StickyNote, Plus } from 'lucide-react'

const INVESTOR_TYPES = [
  'Individual LP',
  'Family Office',
  'Fund of Funds',
  'Institutional',
  'HNW Individual',
  'Strategic',
  'Other'
]

const INVESTOR_STATUSES = [
  'prospect',
  'contacted',
  'in_conversation',
  'committed',
  'invested',
  'passed'
]

const INTERACTION_TYPES = [
  { value: 'call', label: 'Call', icon: Phone },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'meeting', label: 'Meeting', icon: Users },
  { value: 'linkedin_message', label: 'LinkedIn Message', icon: Linkedin },
  { value: 'event', label: 'Event', icon: Calendar },
  { value: 'intro', label: 'Intro', icon: Handshake },
  { value: 'note', label: 'Note', icon: StickyNote }
]

function formatStatusLabel(status) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatCheckSize(min, max) {
  const fmt = (v) => {
    if (!v) return null
    if (v >= 1000000) return `$${(v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1)}M`
    if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`
    return `$${v}`
  }
  const fMin = fmt(min)
  const fMax = fmt(max)
  if (fMin && fMax) return `${fMin} – ${fMax}`
  if (fMin) return `${fMin}+`
  if (fMax) return `Up to ${fMax}`
  return '—'
}

function getInteractionIcon(type) {
  const found = INTERACTION_TYPES.find(t => t.value === type)
  if (!found) return StickyNote
  return found.icon
}

function InvestorDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { currentPerson } = useApp()
  const [investor, setInvestor] = useState(null)
  const [interactions, setInteractions] = useState([])
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [editedInvestor, setEditedInvestor] = useState(null)
  const [showInteractionForm, setShowInteractionForm] = useState(false)
  const [newInteraction, setNewInteraction] = useState({
    interaction_type: 'call',
    interaction_date: new Date().toISOString().split('T')[0],
    notes: ''
  })

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    setLoading(true)
    try {
      const [investorData, interactionsData] = await Promise.all([
        getInvestorById(id),
        getInvestorInteractions(id)
      ])
      setInvestor(investorData)
      setEditedInvestor(investorData)
      setInteractions(interactionsData)
    } catch (error) {
      console.error('Failed to load investor:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    try {
      const updated = await updateInvestor(id, {
        ...editedInvestor,
        check_size_min: editedInvestor.check_size_min ? parseInt(editedInvestor.check_size_min) : null,
        check_size_max: editedInvestor.check_size_max ? parseInt(editedInvestor.check_size_max) : null
      })
      setInvestor(updated)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to update investor:', error)
      alert(`Failed to update investor: ${error.message}`)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${investor.name}? This cannot be undone.`)) return
    try {
      await deleteInvestor(id)
      navigate('/investors')
    } catch (error) {
      console.error('Failed to delete investor:', error)
      alert('Failed to delete investor')
    }
  }

  async function handleAddInteraction() {
    try {
      await logInvestorInteraction(id, newInteraction, currentPerson?.id)
      setNewInteraction({
        interaction_type: 'call',
        interaction_date: new Date().toISOString().split('T')[0],
        notes: ''
      })
      setShowInteractionForm(false)
      await loadData()
    } catch (error) {
      console.error('Failed to log interaction:', error)
      alert('Failed to log interaction')
    }
  }

  async function handleDeleteInteraction(interactionId) {
    if (!confirm('Delete this interaction?')) return
    try {
      await deleteInvestorInteraction(interactionId)
      await loadData()
    } catch (error) {
      console.error('Failed to delete interaction:', error)
    }
  }

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1>Investor Details</h1></div>
        <div className="loading">Loading...</div>
      </div>
    )
  }

  if (!investor) {
    return (
      <div>
        <div className="page-header"><h1>Investor Not Found</h1></div>
        <Link to="/investors">Back to Investor Contacts</Link>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link to="/investors" className="back-link"><ArrowLeft size={20} /></Link>
          <h1>{investor.name}</h1>
          <span className={`status-badge investor-status-${investor.status}`}>{formatStatusLabel(investor.status)}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {isEditing ? (
            <>
              <button className="btn btn-secondary" onClick={() => { setIsEditing(false); setEditedInvestor(investor) }}>
                <X size={18} /> Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                <Save size={18} /> Save
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={() => setIsEditing(true)}>
                <Edit2 size={18} /> Edit
              </button>
              <button className="btn btn-danger" onClick={handleDelete}>
                <Trash2 size={18} /> Delete
              </button>
            </>
          )}
        </div>
      </div>

      <div className="lead-detail-grid">
        {/* Left Column - Investor Info */}
        <div className="card">
          <div className="card-header"><h3>Investor Information</h3></div>
          <div style={{ padding: '16px' }}>
            {isEditing ? (
              <div style={{ display: 'grid', gap: '12px' }}>
                <div>
                  <label className="form-label">Name</label>
                  <input className="form-input" value={editedInvestor.name || ''} onChange={(e) => setEditedInvestor({ ...editedInvestor, name: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Firm</label>
                  <input className="form-input" value={editedInvestor.firm || ''} onChange={(e) => setEditedInvestor({ ...editedInvestor, firm: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={editedInvestor.email || ''} onChange={(e) => setEditedInvestor({ ...editedInvestor, email: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={editedInvestor.phone || ''} onChange={(e) => setEditedInvestor({ ...editedInvestor, phone: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">LinkedIn URL</label>
                  <input className="form-input" value={editedInvestor.linkedin_url || ''} onChange={(e) => setEditedInvestor({ ...editedInvestor, linkedin_url: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Investor Type</label>
                  <select className="form-select" value={editedInvestor.investor_type || ''} onChange={(e) => setEditedInvestor({ ...editedInvestor, investor_type: e.target.value })}>
                    {INVESTOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Check Size Min ($)</label>
                  <input className="form-input" type="number" value={editedInvestor.check_size_min || ''} onChange={(e) => setEditedInvestor({ ...editedInvestor, check_size_min: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Check Size Max ($)</label>
                  <input className="form-input" type="number" value={editedInvestor.check_size_max || ''} onChange={(e) => setEditedInvestor({ ...editedInvestor, check_size_max: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Status</label>
                  <select className="form-select" value={editedInvestor.status || ''} onChange={(e) => setEditedInvestor({ ...editedInvestor, status: e.target.value })}>
                    {INVESTOR_STATUSES.map(s => <option key={s} value={s}>{formatStatusLabel(s)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Investment Focus</label>
                  <input className="form-input" value={editedInvestor.investment_focus || ''} onChange={(e) => setEditedInvestor({ ...editedInvestor, investment_focus: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Notes</label>
                  <textarea className="form-textarea" rows={4} value={editedInvestor.notes || ''} onChange={(e) => setEditedInvestor({ ...editedInvestor, notes: e.target.value })} />
                </div>
              </div>
            ) : (
              <div className="detail-fields">
                {investor.firm && (
                  <div className="detail-row">
                    <span className="detail-label">Firm</span>
                    <span className="detail-value">{investor.firm}</span>
                  </div>
                )}
                {investor.email && (
                  <div className="detail-row">
                    <span className="detail-label">Email</span>
                    <span className="detail-value"><a href={`mailto:${investor.email}`}>{investor.email}</a></span>
                  </div>
                )}
                {investor.phone && (
                  <div className="detail-row">
                    <span className="detail-label">Phone</span>
                    <span className="detail-value"><a href={`tel:${investor.phone}`}>{investor.phone}</a></span>
                  </div>
                )}
                {investor.linkedin_url && (
                  <div className="detail-row">
                    <span className="detail-label">LinkedIn</span>
                    <span className="detail-value"><a href={investor.linkedin_url} target="_blank" rel="noopener noreferrer">Profile</a></span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="detail-label">Type</span>
                  <span className="detail-value"><span className="badge">{investor.investor_type}</span></span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Check Size</span>
                  <span className="detail-value">{formatCheckSize(investor.check_size_min, investor.check_size_max)}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Status</span>
                  <span className="detail-value">
                    <span className={`status-badge investor-status-${investor.status}`}>{formatStatusLabel(investor.status)}</span>
                  </span>
                </div>
                {investor.investment_focus && (
                  <div className="detail-row">
                    <span className="detail-label">Investment Focus</span>
                    <span className="detail-value">{investor.investment_focus}</span>
                  </div>
                )}
                {investor.notes && (
                  <div className="detail-row">
                    <span className="detail-label">Notes</span>
                    <span className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{investor.notes}</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="detail-label">Added</span>
                  <span className="detail-value">{new Date(investor.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Interaction Log */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Interaction Log</h3>
            <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={() => setShowInteractionForm(!showInteractionForm)}>
              <Plus size={16} /> Log Interaction
            </button>
          </div>

          {showInteractionForm && (
            <div style={{ padding: '16px', borderBottom: '1px solid var(--gray-200)', background: 'var(--gray-50)' }}>
              <div style={{ display: 'grid', gap: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label className="form-label">Type</label>
                    <select className="form-select" value={newInteraction.interaction_type} onChange={(e) => setNewInteraction({ ...newInteraction, interaction_type: e.target.value })}>
                      {INTERACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Date</label>
                    <input className="form-input" type="date" value={newInteraction.interaction_date} onChange={(e) => setNewInteraction({ ...newInteraction, interaction_date: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="form-label">Notes</label>
                  <textarea className="form-textarea" rows={3} value={newInteraction.notes} onChange={(e) => setNewInteraction({ ...newInteraction, notes: e.target.value })} placeholder="What happened?" />
                </div>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary" onClick={() => setShowInteractionForm(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleAddInteraction}>Log Interaction</button>
                </div>
              </div>
            </div>
          )}

          <div style={{ padding: '16px' }}>
            {interactions.length === 0 ? (
              <p style={{ color: 'var(--gray-400)', textAlign: 'center', padding: '24px 0' }}>No interactions logged yet.</p>
            ) : (
              <div className="activity-timeline">
                {interactions.map(interaction => {
                  const IconComponent = getInteractionIcon(interaction.interaction_type)
                  const typeLabel = INTERACTION_TYPES.find(t => t.value === interaction.interaction_type)?.label || interaction.interaction_type

                  return (
                    <div key={interaction.id} className="activity-item">
                      <div className="activity-icon">
                        <IconComponent size={16} />
                      </div>
                      <div className="activity-content">
                        <div className="activity-header">
                          <strong>{typeLabel}</strong>
                          <span className="activity-date">
                            {new Date(interaction.interaction_date).toLocaleDateString()}
                          </span>
                        </div>
                        {interaction.notes && (
                          <p className="activity-notes">{interaction.notes}</p>
                        )}
                        <div className="activity-meta">
                          {interaction.logged_by_person?.name && (
                            <span>Logged by {interaction.logged_by_person.name}</span>
                          )}
                          <button
                            className="btn-icon-danger"
                            onClick={() => handleDeleteInteraction(interaction.id)}
                            title="Delete interaction"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default InvestorDetail
