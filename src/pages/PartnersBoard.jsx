import { useState, useEffect, useMemo } from 'react'
import { getPartners, createPartner, updatePartner, movePartner, deletePartner } from '../lib/crm-api'
import { useApp } from '../App'
import { useToast } from '../components/Toast'
import { useSessionState } from '../hooks/useSessionState'
import { Plus, Search, Trash2, ExternalLink } from 'lucide-react'

const STAGES = [
  { key: 'potential', label: 'Potential', color: '#a78bfa' },
  { key: 'reached_out', label: 'Reached Out', color: '#60a5fa' },
  { key: 'in_conversation', label: 'In Conversation', color: '#fbbf24' },
  { key: 'active_partner', label: 'Active Partner', color: '#22c55e' },
  { key: 'passed', label: 'Passed', color: '#9ca3af' }
]

const CATEGORIES = [
  { key: 'creator', label: 'Creator', color: '#ec4899' },
  { key: 'community', label: 'Community', color: '#8b5cf6' },
  { key: 'investor', label: 'Investor', color: '#3b82f6' },
  { key: 'fund', label: 'Fund', color: '#06b6d4' },
  { key: 'podcast', label: 'Podcast', color: '#f59e0b' },
  { key: 'media', label: 'Media', color: '#ef4444' },
  { key: 'competitor', label: 'Competitor', color: '#6b7280' },
  { key: 'adjacent_industry', label: 'Adjacent Industry', color: '#14b8a6' }
]

const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map(c => [c.key, c]))

function PartnersBoard() {
  const { currentPerson } = useApp()
  const { toast } = useToast()
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingPartner, setEditingPartner] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [draggedPartner, setDraggedPartner] = useState(null)

  const [searchQuery, setSearchQuery] = useSessionState('pb:searchQuery', '')
  const [categoryFilter, setCategoryFilter] = useSessionState('pb:categoryFilter', 'all')

  useEffect(() => {
    loadPartners()
  }, [currentPerson?.id])

  async function loadPartners() {
    if (!currentPerson?.id) return
    setLoading(true)
    try {
      const data = await getPartners(currentPerson.id)
      setPartners(data)
    } catch (err) {
      console.error('Failed to load partners:', err)
      toast.error('Failed to load partners')
    } finally {
      setLoading(false)
    }
  }

  const filteredPartners = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return partners.filter(p => {
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false
      if (!q) return true
      return (
        (p.name || '').toLowerCase().includes(q) ||
        (p.handle || '').toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q)
      )
    })
  }, [partners, searchQuery, categoryFilter])

  function partnersInStage(stage) {
    return filteredPartners.filter(p => p.stage === stage)
  }

  function handleDragStart(e, partner) {
    setDraggedPartner(partner)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  async function handleDrop(e, newStage) {
    e.preventDefault()
    if (!draggedPartner || draggedPartner.stage === newStage) {
      setDraggedPartner(null)
      return
    }
    const prev = partners
    setPartners(prev.map(p => p.id === draggedPartner.id ? { ...p, stage: newStage } : p))
    setDraggedPartner(null)
    try {
      await movePartner(draggedPartner.id, newStage)
    } catch (err) {
      console.error('Failed to move partner:', err)
      toast.error('Failed to move partner')
      setPartners(prev)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this partner?')) return
    const prev = partners
    setPartners(prev.filter(p => p.id !== id))
    try {
      await deletePartner(id)
      toast.success('Partner deleted')
    } catch (err) {
      console.error('Failed to delete partner:', err)
      toast.error('Failed to delete')
      setPartners(prev)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0 }}>Potential Partners</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0 0' }}>Personal pipeline for partnership outreach</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
          <Plus size={16} /> Add Partner
        </button>
      </div>

      <div className="card" style={{ padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input
            type="text"
            placeholder="Search by name, handle, or notes..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="form-control"
            style={{ paddingLeft: '34px', fontSize: '13px' }}
          />
        </div>

        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="form-control"
          style={{ width: 'auto', fontSize: '13px' }}
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map(c => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>

        <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#6b7280' }}>
          <strong style={{ color: '#111827' }}>{filteredPartners.length}</strong> shown
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 12px' }}></div>
          Loading partners…
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px' }}>
          {STAGES.map(stage => {
            const items = partnersInStage(stage.key)
            return (
              <div
                key={stage.key}
                onDragOver={handleDragOver}
                onDrop={e => handleDrop(e, stage.key)}
                style={{
                  flex: '0 0 280px',
                  background: '#f9fafb',
                  borderRadius: '8px',
                  padding: '12px',
                  minHeight: '300px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: stage.color }}></span>
                  <strong style={{ fontSize: '13px', color: '#111827' }}>{stage.label}</strong>
                  <span style={{ fontSize: '11px', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{items.length}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {items.map(p => (
                    <PartnerCard
                      key={p.id}
                      partner={p}
                      onEdit={() => setEditingPartner(p)}
                      onDelete={() => handleDelete(p.id)}
                      onDragStart={handleDragStart}
                    />
                  ))}
                  {items.length === 0 && (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
                      Drag a partner here
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(showAddForm || editingPartner) && (
        <PartnerForm
          partner={editingPartner}
          onClose={() => { setShowAddForm(false); setEditingPartner(null) }}
          onSave={async (formData) => {
            try {
              if (editingPartner) {
                await updatePartner(editingPartner.id, formData)
                toast.success('Partner updated')
              } else {
                await createPartner(formData, currentPerson.id)
                toast.success('Partner added')
              }
              setShowAddForm(false)
              setEditingPartner(null)
              loadPartners()
            } catch (err) {
              console.error('Failed to save partner:', err)
              toast.error('Failed to save: ' + err.message)
            }
          }}
        />
      )}
    </div>
  )
}

function PartnerCard({ partner, onEdit, onDelete, onDragStart }) {
  const cat = CATEGORY_BY_KEY[partner.category]
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, partner)}
      onClick={onEdit}
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '6px',
        padding: '10px 12px',
        cursor: 'grab',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '4px' }}>
        <div style={{ fontWeight: 600, fontSize: '13px', color: '#111827', lineHeight: 1.3 }}>
          {partner.name}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Delete"
          style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '2px' }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {partner.handle && (
        <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>{partner.handle}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        {cat && (
          <span style={{
            fontSize: '10px',
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: '999px',
            background: cat.color + '22',
            color: cat.color
          }}>
            {cat.label}
          </span>
        )}
        {partner.audience_size && (
          <span style={{ fontSize: '10px', color: '#6b7280' }}>{partner.audience_size}</span>
        )}
        {partner.url && (
          <a
            href={partner.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ marginLeft: 'auto', color: '#6b7280' }}
            title={partner.url}
          >
            <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  )
}

function PartnerForm({ partner, onClose, onSave }) {
  const [form, setForm] = useState({
    name: partner?.name || '',
    category: partner?.category || 'creator',
    stage: partner?.stage || 'potential',
    handle: partner?.handle || '',
    url: partner?.url || '',
    email: partner?.email || '',
    audience_size: partner?.audience_size || '',
    next_follow_up_date: partner?.next_follow_up_date || '',
    last_contact_date: partner?.last_contact_date || '',
    notes: partner?.notes || ''
  })
  const [saving, setSaving] = useState(false)

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const payload = { ...form }
      if (!payload.next_follow_up_date) payload.next_follow_up_date = null
      if (!payload.last_contact_date) payload.last_contact_date = null
      await onSave(payload)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
        <h2>{partner ? 'Edit Partner' : 'Add Partner'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => update('name', e.target.value)}
                placeholder="e.g. MKBHD, a16z, IndieHackers"
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Handle</label>
              <input
                type="text"
                value={form.handle}
                onChange={e => update('handle', e.target.value)}
                placeholder="@username or channel name"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Category</label>
              <select value={form.category} onChange={e => update('category', e.target.value)}>
                {CATEGORIES.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Stage</label>
              <select value={form.stage} onChange={e => update('stage', e.target.value)}>
                {STAGES.map(s => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>URL</label>
              <input
                type="url"
                value={form.url}
                onChange={e => update('url', e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => update('email', e.target.value)}
                placeholder="contact@example.com"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Audience Size</label>
              <input
                type="text"
                value={form.audience_size}
                onChange={e => update('audience_size', e.target.value)}
                placeholder="e.g. 50K subs, 200K followers"
              />
            </div>
            <div className="form-group">
              <label>Last Contact</label>
              <input
                type="date"
                value={form.last_contact_date}
                onChange={e => update('last_contact_date', e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Next Follow-up</label>
            <input
              type="date"
              value={form.next_follow_up_date}
              onChange={e => update('next_follow_up_date', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Notes</label>
            <textarea
              value={form.notes}
              onChange={e => update('notes', e.target.value)}
              rows={4}
              placeholder="Why this partner, conversation history, etc."
            />
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving...' : partner ? 'Update' : 'Add Partner'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default PartnersBoard
