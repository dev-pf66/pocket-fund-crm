import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getInvestors, createInvestor, updateInvestor, deleteInvestor } from '../lib/crm-api'
import { useApp } from '../App'
import { Plus, Search, Edit2, Trash2, X } from 'lucide-react'

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

const EMPTY_FORM = {
  name: '',
  firm: '',
  email: '',
  phone: '',
  linkedin_url: '',
  investor_type: 'Individual LP',
  check_size_min: '',
  check_size_max: '',
  investment_focus: '',
  status: 'prospect',
  notes: ''
}

function formatCheckSize(min, max) {
  const fmt = (v) => {
    if (!v) return null
    if (v >= 1000000) return `$${(v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1)}M`
    if (v >= 1000) return `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 0)}K`
    return `$${v}`
  }
  const fMin = fmt(min)
  const fMax = fmt(max)
  if (fMin && fMax) return `${fMin} – ${fMax}`
  if (fMin) return `${fMin}+`
  if (fMax) return `Up to ${fMax}`
  return '—'
}

function formatStatusLabel(status) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function Investors() {
  const { currentPerson } = useApp()
  const navigate = useNavigate()
  const [investors, setInvestors] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingInvestor, setEditingInvestor] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [formData, setFormData] = useState(EMPTY_FORM)

  useEffect(() => {
    loadInvestors()
  }, [])

  async function loadInvestors() {
    setLoading(true)
    try {
      const data = await getInvestors()
      setInvestors(data)
    } catch (error) {
      console.error('Failed to load investors:', error)
    } finally {
      setLoading(false)
    }
  }

  function getFilteredInvestors() {
    return investors.filter(inv => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const matchName = inv.name?.toLowerCase().includes(q)
        const matchFirm = inv.firm?.toLowerCase().includes(q)
        const matchEmail = inv.email?.toLowerCase().includes(q)
        if (!matchName && !matchFirm && !matchEmail) return false
      }
      if (filterType && inv.investor_type !== filterType) return false
      if (filterStatus && inv.status !== filterStatus) return false
      return true
    })
  }

  function handleEdit(e, investor) {
    e.stopPropagation()
    setEditingInvestor(investor)
    setFormData({
      name: investor.name || '',
      firm: investor.firm || '',
      email: investor.email || '',
      phone: investor.phone || '',
      linkedin_url: investor.linkedin_url || '',
      investor_type: investor.investor_type || 'Individual LP',
      check_size_min: investor.check_size_min || '',
      check_size_max: investor.check_size_max || '',
      investment_focus: investor.investment_focus || '',
      status: investor.status || 'prospect',
      notes: investor.notes || ''
    })
    setShowForm(true)
  }

  async function handleDelete(e, investor) {
    e.stopPropagation()
    if (!confirm(`Delete ${investor.name}? This cannot be undone.`)) return
    try {
      await deleteInvestor(investor.id)
      await loadInvestors()
    } catch (error) {
      console.error('Failed to delete investor:', error)
      alert('Failed to delete investor')
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    try {
      const payload = {
        ...formData,
        check_size_min: formData.check_size_min ? parseInt(formData.check_size_min) : null,
        check_size_max: formData.check_size_max ? parseInt(formData.check_size_max) : null
      }

      if (editingInvestor) {
        await updateInvestor(editingInvestor.id, payload)
      } else {
        await createInvestor(payload, currentPerson?.id)
      }

      setShowForm(false)
      setEditingInvestor(null)
      setFormData(EMPTY_FORM)
      await loadInvestors()
    } catch (error) {
      console.error('Failed to save investor:', error)
      alert('Failed to save investor')
    }
  }

  function handleCancel() {
    setShowForm(false)
    setEditingInvestor(null)
    setFormData(EMPTY_FORM)
  }

  const filtered = getFilteredInvestors()

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1>Investor Contacts</h1></div>
        <div className="loading">Loading investors...</div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1>Investor Contacts</h1>
        <button className="btn btn-primary" onClick={() => { setEditingInvestor(null); setFormData(EMPTY_FORM); setShowForm(true) }}>
          <Plus size={18} />
          Add Investor
        </button>
      </div>

      {/* Search + Filters */}
      <div className="pipeline-controls">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search by name, firm, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-search" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>
        <div className="filter-bar" style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="form-select">
            <option value="">All Types</option>
            {INVESTOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="form-select">
            <option value="">All Statuses</option>
            {INVESTOR_STATUSES.map(s => <option key={s} value={s}>{formatStatusLabel(s)}</option>)}
          </select>
        </div>
      </div>

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={handleCancel}>
          <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>{editingInvestor ? 'Edit Investor' : 'Add New Investor'}</h2>

            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label>Name *</label>
                  <input type="text" required autoFocus value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Full Name" />
                </div>
                <div className="form-group">
                  <label>Firm</label>
                  <input type="text" value={formData.firm} onChange={(e) => setFormData({ ...formData, firm: e.target.value })} placeholder="Fund / Office Name" />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="email@example.com" />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="+1 (555) 123-4567" />
                </div>
              </div>

              <div className="form-group">
                <label>LinkedIn URL</label>
                <input type="url" value={formData.linkedin_url} onChange={(e) => setFormData({ ...formData, linkedin_url: e.target.value })} placeholder="https://linkedin.com/in/..." />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Investor Type</label>
                  <select value={formData.investor_type} onChange={(e) => setFormData({ ...formData, investor_type: e.target.value })}>
                    {INVESTOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
                    {INVESTOR_STATUSES.map(s => <option key={s} value={s}>{formatStatusLabel(s)}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Check Size Min ($)</label>
                  <input type="number" value={formData.check_size_min} onChange={(e) => setFormData({ ...formData, check_size_min: e.target.value })} placeholder="e.g. 25000" />
                </div>
                <div className="form-group">
                  <label>Check Size Max ($)</label>
                  <input type="number" value={formData.check_size_max} onChange={(e) => setFormData({ ...formData, check_size_max: e.target.value })} placeholder="e.g. 100000" />
                </div>
              </div>

              <div className="form-group">
                <label>Investment Focus</label>
                <input type="text" value={formData.investment_focus} onChange={(e) => setFormData({ ...formData, investment_focus: e.target.value })} placeholder="e.g. SMB SaaS, services, healthcare" />
              </div>

              <div className="form-group">
                <label>Notes</label>
                <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Context, intro source, preferences..." rows={3} />
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingInvestor ? 'Update Investor' : 'Add Investor'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Firm</th>
                <th>Type</th>
                <th>Check Size</th>
                <th>Status</th>
                <th>Last Updated</th>
                <th style={{ width: '100px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: 'var(--gray-400)' }}>
                    {investors.length === 0 ? 'No investors yet. Add your first investor contact above.' : 'No investors match your filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map(inv => (
                  <tr key={inv.id} onClick={() => navigate(`/investors/${inv.id}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 600 }}>{inv.name}</td>
                    <td>{inv.firm || '—'}</td>
                    <td><span className="badge">{inv.investor_type}</span></td>
                    <td>{formatCheckSize(inv.check_size_min, inv.check_size_max)}</td>
                    <td><span className={`status-badge investor-status-${inv.status}`}>{formatStatusLabel(inv.status)}</span></td>
                    <td>{inv.updated_at ? new Date(inv.updated_at).toLocaleDateString() : '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={(e) => handleEdit(e, inv)} title="Edit">
                          <Edit2 size={14} />
                        </button>
                        <button className="btn btn-danger" style={{ padding: '4px 8px' }} onClick={(e) => handleDelete(e, inv)} title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default Investors
