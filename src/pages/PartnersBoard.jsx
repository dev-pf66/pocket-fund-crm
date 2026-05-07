import { useState, useEffect, useMemo } from 'react'
import { getPartners, createPartner, updatePartner, movePartner, deletePartner } from '../lib/crm-api'
import { useApp } from '../App'
import { useToast } from '../components/Toast'
import { useSessionState } from '../hooks/useSessionState'
import { useIsMobileDevice } from '../hooks/useIsMobileDevice'
import { Plus, Search, Trash2, ExternalLink, Linkedin, Calendar, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { isLinkedInUrl, nameFromLinkedInUrl } from '../lib/linkedin'
import { istToday } from '../lib/dateUtils'

const todayStr = istToday

// Days until / since a YYYY-MM-DD date relative to today. Negative = overdue.
function daysUntil(dateStr) {
  if (!dateStr) return null
  const today = new Date(todayStr() + 'T00:00:00')
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  return Math.round((d - today) / (1000 * 60 * 60 * 24))
}

// Bucket a partner's follow-up date for badges + the due-list at the top.
// Returns null if there's no follow-up scheduled or it's still far out.
function followUpStatus(dateStr) {
  const days = daysUntil(dateStr)
  if (days === null) return null
  if (days < 0) return { kind: 'overdue', label: `${-days}d overdue`, color: '#dc2626' }
  if (days === 0) return { kind: 'today', label: 'Due today', color: '#d97706' }
  if (days <= 3) return { kind: 'soon', label: `In ${days}d`, color: '#ca8a04' }
  return null
}

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

// Normalize a free-text category name to a stable key (lowercased, spaces
// and other separators collapsed to underscores).
function categoryKeyFromLabel(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
}

// Title-case a category key for display.
function labelForCategory(key) {
  if (CATEGORY_BY_KEY[key]) return CATEGORY_BY_KEY[key].label
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// Stable color from a string so custom categories get a consistent hue.
function colorForCategory(key) {
  if (CATEGORY_BY_KEY[key]) return CATEGORY_BY_KEY[key].color
  let h = 0
  for (let i = 0; i < (key || '').length; i += 1) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0
  }
  return `hsl(${h % 360}, 55%, 48%)`
}

// Multi-select chip group. Click a chip to toggle whether the partner
// belongs to that category. The "+ Add" chip lets the user add a custom
// category — handed to onAddCustom so the parent can persist it across
// chips and the filter dropdown.
function CategoryChips({ value, onChange, available, onAddCustom, disabled = false }) {
  const arr = Array.isArray(value) ? value : []
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  function toggle(key) {
    if (disabled) return
    if (arr.includes(key)) onChange(arr.filter(k => k !== key))
    else onChange([...arr, key])
  }

  function commitDraft() {
    const key = categoryKeyFromLabel(draft)
    if (!key) {
      setAdding(false)
      setDraft('')
      return
    }
    if (onAddCustom) onAddCustom(key)
    if (!arr.includes(key)) onChange([...arr, key])
    setAdding(false)
    setDraft('')
  }

  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
      {available.map(key => {
        const selected = arr.includes(key)
        const color = colorForCategory(key)
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            disabled={disabled}
            style={{
              padding: '4px 10px',
              borderRadius: '999px',
              border: selected ? `1.5px solid ${color}` : '1px solid #e5e7eb',
              background: selected ? color + '22' : 'white',
              color: selected ? color : '#6b7280',
              fontSize: '12px',
              fontWeight: selected ? 600 : 500,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1
            }}
          >
            {labelForCategory(key)}
          </button>
        )
      })}
      {adding ? (
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitDraft() }
            if (e.key === 'Escape') { setAdding(false); setDraft('') }
          }}
          placeholder="New category"
          maxLength={50}
          style={{
            padding: '4px 10px',
            borderRadius: '999px',
            border: '1px dashed #9ca3af',
            background: 'white',
            fontSize: '12px',
            outline: 'none',
            minWidth: '120px'
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={disabled}
          style={{
            padding: '4px 10px',
            borderRadius: '999px',
            border: '1px dashed #9ca3af',
            background: 'white',
            color: '#6b7280',
            fontSize: '12px',
            fontWeight: 500,
            cursor: disabled ? 'not-allowed' : 'pointer'
          }}
        >
          + Add
        </button>
      )}
    </div>
  )
}

function PartnersBoard() {
  const { currentPerson } = useApp()
  const { toast } = useToast()
  const isMobile = useIsMobileDevice()
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingPartner, setEditingPartner] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [draggedPartner, setDraggedPartner] = useState(null)
  // When the user clicks a "follow-ups due" partner from the alert banner,
  // the page filters to just that set so they can work through them.
  const [showOnlyDue, setShowOnlyDue] = useSessionState('pb:showOnlyDue', false)
  const [dueExpanded, setDueExpanded] = useSessionState('pb:dueExpanded', false)

  const [searchQuery, setSearchQuery] = useSessionState('pb:searchQuery', '')
  const [categoryFilter, setCategoryFilter] = useSessionState('pb:categoryFilter', 'all')

  // LinkedIn quick-add: paste a profile URL, toggle one or more categories,
  // hit Add. Multi-select so a contact can be both e.g. Creator + Podcast.
  const [quickUrl, setQuickUrl] = useState('')
  const [quickCategories, setQuickCategories] = useSessionState('pb:quickCategories', ['creator'])
  const [quickAdding, setQuickAdding] = useState(false)

  // Custom categories the user added in this browser. Persisted to session
  // so they survive page reloads even before they're attached to a partner.
  // The full chip list = built-in + categories actually in use on partners
  // + recently-added customs.
  const [customCategories, setCustomCategories] = useSessionState('pb:customCategories', [])

  function registerCustomCategory(key) {
    if (!key || CATEGORY_BY_KEY[key]) return
    setCustomCategories(prev => prev.includes(key) ? prev : [...prev, key])
  }

  const availableCategories = useMemo(() => {
    const seen = new Set(CATEGORIES.map(c => c.key))
    const out = CATEGORIES.map(c => c.key)
    for (const p of partners) {
      for (const k of (p.categories || [])) {
        if (!seen.has(k)) { seen.add(k); out.push(k) }
      }
    }
    for (const k of customCategories) {
      if (!seen.has(k)) { seen.add(k); out.push(k) }
    }
    return out
  }, [partners, customCategories])

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

  // Partners whose follow-up date is today or earlier, sorted oldest first
  // so the most-overdue surface at the top of the alert banner.
  const dueFollowUps = useMemo(() => {
    return partners
      .filter(p => {
        if (p.stage === 'passed' || p.stage === 'active_partner') return false
        const days = daysUntil(p.next_follow_up_date)
        return days !== null && days <= 0
      })
      .sort((a, b) => String(a.next_follow_up_date).localeCompare(String(b.next_follow_up_date)))
  }, [partners])

  const filteredPartners = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const dueIds = new Set(dueFollowUps.map(p => p.id))
    return partners.filter(p => {
      if (showOnlyDue && !dueIds.has(p.id)) return false
      if (categoryFilter !== 'all' && !(p.categories || []).includes(categoryFilter)) return false
      if (!q) return true
      return (
        (p.name || '').toLowerCase().includes(q) ||
        (p.handle || '').toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q)
      )
    })
  }, [partners, searchQuery, categoryFilter, showOnlyDue, dueFollowUps])

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

  async function handleQuickAdd(e) {
    e.preventDefault()
    const url = quickUrl.trim()
    if (!url || quickAdding) return
    if (!isLinkedInUrl(url)) {
      toast.warn('That doesn\'t look like a LinkedIn URL')
      return
    }
    if (!quickCategories.length) {
      toast.warn('Pick at least one category')
      return
    }
    if (!currentPerson?.id) {
      toast.error('Please wait — loading user info')
      return
    }
    setQuickAdding(true)
    try {
      const guessed = nameFromLinkedInUrl(url) || ''
      // A single-word slug like "finneganstewart" can't be cleanly split
      // into first + last, so leave the name blank and surface the edit
      // modal — easier than letting the user fix an ugly name later.
      const looksUseful = guessed.trim().split(/\s+/).length >= 2
      const name = looksUseful ? guessed : ''
      const created = await createPartner({
        name: name || 'New Partner',
        categories: quickCategories,
        stage: 'potential',
        url
      }, currentPerson.id)
      setPartners(prev => [created, ...prev])
      setQuickUrl('')
      if (looksUseful) {
        toast.success(`Added ${name}`)
      } else {
        toast.info('Added — fill in the name')
        setEditingPartner(created)
      }
    } catch (err) {
      console.error('Failed to quick-add partner:', err)
      toast.error('Failed to add: ' + err.message)
    } finally {
      setQuickAdding(false)
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
          <h1 style={{ margin: 0 }}>Partners</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0 0' }}>Personal pipeline for partnership outreach</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
          <Plus size={16} /> Add Partner
        </button>
      </div>

      <form
        onSubmit={handleQuickAdd}
        className="card"
        style={{ padding: '12px 16px', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}
      >
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Linkedin size={16} style={{ color: '#0a66c2', flexShrink: 0 }} />
          <input
            type="url"
            placeholder="Paste LinkedIn URL to quick-add..."
            value={quickUrl}
            onChange={e => setQuickUrl(e.target.value)}
            className="form-control"
            style={{ flex: 1, fontSize: '13px' }}
            disabled={quickAdding}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={quickAdding || !quickUrl.trim() || !quickCategories.length}
          >
            {quickAdding ? 'Adding...' : 'Add'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Categories
          </span>
          <CategoryChips
            value={quickCategories}
            onChange={setQuickCategories}
            available={availableCategories}
            onAddCustom={registerCustomCategory}
            disabled={quickAdding}
          />
        </div>
      </form>

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
          {availableCategories.map(key => (
            <option key={key} value={key}>{labelForCategory(key)}</option>
          ))}
        </select>

        <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#6b7280' }}>
          <strong style={{ color: '#111827' }}>{filteredPartners.length}</strong> shown
        </div>
      </div>

      {dueFollowUps.length > 0 && (
        <div
          style={{
            background: '#fff7ed',
            border: '1px solid #fed7aa',
            borderRadius: '8px',
            padding: '12px 14px',
            marginBottom: '16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <AlertCircle size={16} style={{ color: '#c2410c' }} />
            <strong style={{ color: '#9a3412', fontSize: '13px' }}>
              {dueFollowUps.length} follow-up{dueFollowUps.length === 1 ? '' : 's'} due
            </strong>
            <button
              onClick={() => setShowOnlyDue(v => !v)}
              style={{
                background: showOnlyDue ? '#c2410c' : 'white',
                color: showOnlyDue ? 'white' : '#c2410c',
                border: '1px solid #c2410c',
                borderRadius: '999px',
                padding: '3px 10px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {showOnlyDue ? 'Show all' : 'Show only due'}
            </button>
            <button
              onClick={() => setDueExpanded(v => !v)}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: 'none',
                color: '#9a3412',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              {dueExpanded ? 'Collapse' : 'Expand'}
              {dueExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
          {dueExpanded && (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {dueFollowUps.map(p => {
                const status = followUpStatus(p.next_follow_up_date)
                return (
                  <button
                    key={p.id}
                    onClick={() => setEditingPartner(p)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '6px 10px', textAlign: 'left',
                      background: 'white', border: '1px solid #fed7aa',
                      borderRadius: '6px', cursor: 'pointer'
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '13px', color: '#111827' }}>{p.name}</span>
                    {status && (
                      <span style={{
                        fontSize: '10px', fontWeight: 600,
                        padding: '2px 6px', borderRadius: '999px',
                        background: status.color + '22', color: status.color
                      }}>
                        {status.label}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 12px' }}></div>
          Loading partners…
        </div>
      ) : isMobile ? (
        <MobilePartnerList
          stages={STAGES}
          partnersInStage={partnersInStage}
          onEdit={setEditingPartner}
          onDelete={handleDelete}
          onMove={async (partner, newStage) => {
            const prev = partners
            setPartners(prev.map(p => p.id === partner.id ? { ...p, stage: newStage } : p))
            try {
              await movePartner(partner.id, newStage)
            } catch (err) {
              console.error('Failed to move partner:', err)
              toast.error('Failed to move')
              setPartners(prev)
            }
          }}
        />
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
          availableCategories={availableCategories}
          onAddCustomCategory={registerCustomCategory}
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
  const cats = (partner.categories || []).map(k => ({
    key: k,
    label: labelForCategory(k),
    color: colorForCategory(k)
  }))
  const followUp = followUpStatus(partner.next_follow_up_date)
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

      {followUp && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '6px',
          fontSize: '10px', fontWeight: 600,
          padding: '2px 6px', borderRadius: '999px',
          background: followUp.color + '22', color: followUp.color
        }}>
          <Calendar size={10} />
          {followUp.label}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
        {cats.map(c => (
          <span
            key={c.key}
            style={{
              fontSize: '10px',
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: '999px',
              background: c.color + '22',
              color: c.color
            }}
          >
            {c.label}
          </span>
        ))}
        {partner.audience_size && (
          <span style={{ fontSize: '10px', color: '#6b7280', marginLeft: '2px' }}>{partner.audience_size}</span>
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

// Mobile layout: stacked stage sections instead of a horizontal kanban,
// since side-scrolling 5 columns on a phone is unusable. Drag-to-move is
// replaced with a Stage select on each card so touch users can advance
// partners through the pipeline.
function MobilePartnerList({ stages, partnersInStage, onEdit, onDelete, onMove }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {stages.map(stage => {
        const items = partnersInStage(stage.key)
        if (items.length === 0) return null
        return (
          <div key={stage.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', padding: '0 4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: stage.color }} />
              <strong style={{ fontSize: '13px', color: '#111827' }}>{stage.label}</strong>
              <span style={{ fontSize: '11px', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map(p => (
                <MobilePartnerCard
                  key={p.id}
                  partner={p}
                  stages={stages}
                  onEdit={() => onEdit(p)}
                  onDelete={() => onDelete(p.id)}
                  onMove={(newStage) => onMove(p, newStage)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MobilePartnerCard({ partner, stages, onEdit, onDelete, onMove }) {
  const cats = (partner.categories || []).map(k => ({
    key: k,
    label: labelForCategory(k),
    color: colorForCategory(k)
  }))
  const followUp = followUpStatus(partner.next_follow_up_date)
  return (
    <div
      onClick={onEdit}
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '12px 14px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '6px' }}>
        <div style={{ fontWeight: 600, fontSize: '15px', color: '#111827', lineHeight: 1.3 }}>
          {partner.name}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Delete"
          style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '4px' }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {partner.handle && (
        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>{partner.handle}</div>
      )}

      {followUp && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '8px',
          fontSize: '11px', fontWeight: 600,
          padding: '3px 8px', borderRadius: '999px',
          background: followUp.color + '22', color: followUp.color
        }}>
          <Calendar size={11} />
          {followUp.label}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', marginBottom: '10px' }}>
        {cats.map(c => (
          <span
            key={c.key}
            style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: '999px',
              background: c.color + '22',
              color: c.color
            }}
          >
            {c.label}
          </span>
        ))}
        {partner.audience_size && (
          <span style={{ fontSize: '11px', color: '#6b7280', marginLeft: '4px' }}>{partner.audience_size}</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
        <select
          value={partner.stage}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); onMove(e.target.value) }}
          style={{ flex: 1, fontSize: '12px', padding: '6px 8px' }}
        >
          {stages.map(s => (
            <option key={s.key} value={s.key}>Move to: {s.label}</option>
          ))}
        </select>
        {partner.url && (
          <a
            href={partner.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: '#6b7280', padding: '6px' }}
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>
    </div>
  )
}

function PartnerForm({ partner, onClose, onSave, availableCategories, onAddCustomCategory }) {
  const [form, setForm] = useState({
    name: partner?.name || '',
    categories: Array.isArray(partner?.categories) && partner.categories.length
      ? partner.categories
      : ['creator'],
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
    if (!form.categories.length) return
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

          <div className="form-group">
            <label>Categories *</label>
            <CategoryChips
              value={form.categories}
              onChange={(next) => update('categories', next)}
              available={availableCategories}
              onAddCustom={onAddCustomCategory}
              disabled={saving}
            />
          </div>

          <div className="form-group">
            <label>Stage</label>
            <select value={form.stage} onChange={e => update('stage', e.target.value)}>
              {STAGES.map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
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
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !form.name.trim() || !form.categories.length}
            >
              {saving ? 'Saving...' : partner ? 'Update' : 'Add Partner'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default PartnersBoard
