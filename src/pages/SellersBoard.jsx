import { useState, useEffect, useMemo } from 'react'
import { getSellers, createSeller, updateSeller, moveSeller, deleteSeller } from '../lib/crm-api'
import { useApp } from '../App'
import { useToast } from '../components/Toast'
import { useSessionState } from '../hooks/useSessionState'
import { useIsMobileDevice } from '../hooks/useIsMobileDevice'
import { Plus, Search, Trash2, ExternalLink, Calendar, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { istToday } from '../lib/dateUtils'
import { runBulk } from '../lib/bulkActions'

const todayStr = istToday

// Indian-sellers buyside acquisition pipeline. Deliberately separate from the
// sales leads board — sellers are acquisition targets, not sales leads, and
// stay out of the sales funnel / outreach entirely.
const STAGES = [
  { key: 'sourced',    label: 'Sourced',    color: '#a78bfa' },
  { key: 'contacted',  label: 'Contacted',  color: '#60a5fa' },
  { key: 'intro_call', label: 'Intro Call', color: '#06b6d4' },
  { key: 'evaluating', label: 'Evaluating', color: '#fbbf24' },
  { key: 'loi_offer',  label: 'LOI/Offer',  color: '#f97316' },
  { key: 'acquired',   label: 'Acquired',   color: '#22c55e' },
  { key: 'passed',     label: 'Passed',     color: '#9ca3af' },
]

// Terminal stages don't need follow-up nudges.
const TERMINAL_STAGES = new Set(['acquired', 'passed'])

// Days until / since a YYYY-MM-DD date relative to today. Negative = overdue.
function daysUntil(dateStr) {
  if (!dateStr) return null
  const today = new Date(todayStr() + 'T00:00:00')
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  return Math.round((d - today) / (1000 * 60 * 60 * 24))
}

// Bucket a seller's follow-up date for badges + the due-list at the top.
function followUpStatus(dateStr) {
  const days = daysUntil(dateStr)
  if (days === null) return null
  if (days < 0) return { kind: 'overdue', label: `${-days}d overdue`, color: '#dc2626' }
  if (days === 0) return { kind: 'today', label: 'Due today', color: '#d97706' }
  if (days <= 3) return { kind: 'soon', label: `In ${days}d`, color: '#ca8a04' }
  return null
}

function initials(name) {
  return (name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function SellersBoard() {
  const { currentPerson, people } = useApp()
  const { toast } = useToast()
  const isMobile = useIsMobileDevice()
  const [sellers, setSellers] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingSeller, setEditingSeller] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [draggedSeller, setDraggedSeller] = useState(null)
  const [showOnlyDue, setShowOnlyDue] = useSessionState('sb:showOnlyDue', false)
  const [dueExpanded, setDueExpanded] = useSessionState('sb:dueExpanded', false)
  const [searchQuery, setSearchQuery] = useSessionState('sb:searchQuery', '')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkAssignee, setBulkAssignee] = useState('')
  const [bulkStage, setBulkStage] = useState('')

  const peopleById = useMemo(
    () => Object.fromEntries((people || []).map(p => [p.id, p])),
    [people]
  )

  useEffect(() => {
    loadSellers()
  }, [])

  async function loadSellers() {
    setLoading(true)
    try {
      const data = await getSellers()
      setSellers(data)
    } catch (err) {
      console.error('Failed to load sellers:', err)
      toast.error('Failed to load sellers')
    } finally {
      setLoading(false)
    }
  }

  // Sellers whose follow-up is due today or earlier, oldest first.
  const dueFollowUps = useMemo(() => {
    return sellers
      .filter(s => {
        if (TERMINAL_STAGES.has(s.stage)) return false
        const days = daysUntil(s.next_follow_up_date)
        return days !== null && days <= 0
      })
      .sort((a, b) => String(a.next_follow_up_date).localeCompare(String(b.next_follow_up_date)))
  }, [sellers])

  const filteredSellers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const dueIds = new Set(dueFollowUps.map(s => s.id))
    return sellers.filter(s => {
      if (showOnlyDue && !dueIds.has(s.id)) return false
      if (!q) return true
      return (
        (s.name || '').toLowerCase().includes(q) ||
        (s.business_name || '').toLowerCase().includes(q) ||
        (s.industry || '').toLowerCase().includes(q) ||
        (s.location || '').toLowerCase().includes(q) ||
        (s.notes || '').toLowerCase().includes(q)
      )
    })
  }, [sellers, searchQuery, showOnlyDue, dueFollowUps])

  function sellersInStage(stage) {
    return filteredSellers.filter(s => s.stage === stage)
  }

  // Drop any selected id that's scrolled out of the filtered set.
  useEffect(() => {
    const visible = new Set(filteredSellers.map(s => s.id))
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [filteredSellers])

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    const ids = filteredSellers.map(s => s.id)
    setSelectedIds(prev => {
      const allSelected = ids.length > 0 && ids.every(id => prev.has(id))
      return allSelected ? new Set() : new Set(ids)
    })
  }

  async function handleBulkReassign() {
    if (!selectedIds.size || !bulkAssignee) return
    setBulkBusy(true)
    try {
      const targets = filteredSellers.filter(s => selectedIds.has(s.id))
      const { succeeded, failed } = await runBulk(targets, s => updateSeller(s.id, { assigned_to: parseInt(bulkAssignee, 10) }))
      toast.success(`Reassigned ${succeeded.length} seller${succeeded.length === 1 ? '' : 's'}`)
      if (failed.length) toast.error(`${failed.length} failed to reassign`)
      setSelectedIds(new Set())
      setBulkAssignee('')
      await loadSellers()
    } catch (err) {
      console.error('Bulk reassign failed:', err)
      toast.error('Bulk reassign failed: ' + err.message)
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleBulkStageMove() {
    if (!selectedIds.size || !bulkStage) return
    setBulkBusy(true)
    try {
      const targets = filteredSellers.filter(s => selectedIds.has(s.id))
      const { succeeded, failed } = await runBulk(targets, s => moveSeller(s.id, bulkStage))
      toast.success(`Moved ${succeeded.length} seller${succeeded.length === 1 ? '' : 's'}`)
      if (failed.length) toast.error(`${failed.length} failed to move`)
      setSelectedIds(new Set())
      setBulkStage('')
      await loadSellers()
    } catch (err) {
      console.error('Bulk stage move failed:', err)
      toast.error('Bulk move failed: ' + err.message)
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleBulkDelete() {
    if (!selectedIds.size) return
    if (!confirm(`Delete ${selectedIds.size} seller${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`)) return
    setBulkBusy(true)
    try {
      const targets = filteredSellers.filter(s => selectedIds.has(s.id))
      const { succeeded, failed } = await runBulk(targets, s => deleteSeller(s.id))
      toast.success(`Deleted ${succeeded.length} seller${succeeded.length === 1 ? '' : 's'}`)
      if (failed.length) toast.error(`${failed.length} failed to delete`)
      setSelectedIds(new Set())
      await loadSellers()
    } catch (err) {
      console.error('Bulk delete failed:', err)
      toast.error('Bulk delete failed: ' + err.message)
    } finally {
      setBulkBusy(false)
    }
  }

  function handleDragStart(e, seller) {
    setDraggedSeller(seller)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  async function handleDrop(e, newStage) {
    e.preventDefault()
    if (!draggedSeller || draggedSeller.stage === newStage) {
      setDraggedSeller(null)
      return
    }
    const prev = sellers
    setSellers(prev.map(s => s.id === draggedSeller.id ? { ...s, stage: newStage } : s))
    setDraggedSeller(null)
    try {
      await moveSeller(draggedSeller.id, newStage)
    } catch (err) {
      console.error('Failed to move seller:', err)
      toast.error('Failed to move seller')
      setSellers(prev)
    }
  }

  async function handleMove(seller, newStage) {
    const prev = sellers
    setSellers(prev.map(s => s.id === seller.id ? { ...s, stage: newStage } : s))
    try {
      await moveSeller(seller.id, newStage)
    } catch (err) {
      console.error('Failed to move seller:', err)
      toast.error('Failed to move')
      setSellers(prev)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this seller?')) return
    const prev = sellers
    setSellers(prev.filter(s => s.id !== id))
    try {
      await deleteSeller(id)
      toast.success('Seller deleted')
    } catch (err) {
      console.error('Failed to delete seller:', err)
      toast.error('Failed to delete')
      setSellers(prev)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0 }}>Indian Sellers</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0 0' }}>Buyside pipeline for Indian businesses we're meeting with</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
          <Plus size={16} /> Add Seller
        </button>
      </div>

      <div className="card" style={{ padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input
            type="text"
            placeholder="Search by name, business, industry, or notes..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="form-control"
            style={{ paddingLeft: '34px', fontSize: '13px' }}
          />
        </div>
        <button className="btn btn-sm btn-secondary" onClick={toggleSelectAll} disabled={filteredSellers.length === 0}>
          {filteredSellers.length > 0 && filteredSellers.every(s => selectedIds.has(s.id)) ? 'Deselect all' : 'Select all shown'}
        </button>
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#6b7280' }}>
          <strong style={{ color: '#111827' }}>{filteredSellers.length}</strong> shown
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div
          className="card"
          style={{
            padding: '10px 16px', marginBottom: '16px', display: 'flex',
            alignItems: 'center', justifyContent: 'space-between', gap: '12px',
            flexWrap: 'wrap', background: '#eff6ff', border: '1px solid #bfdbfe',
            position: 'sticky', top: '8px', zIndex: 5
          }}
        >
          <span style={{ fontSize: '14px', color: '#1e3a8a', fontWeight: 500 }}>
            {selectedIds.size} seller{selectedIds.size === 1 ? '' : 's'} selected
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <select value={bulkAssignee} onChange={(e) => setBulkAssignee(e.target.value)} className="form-select" disabled={bulkBusy}>
              <option value="">Reassign to…</option>
              {(people || []).map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
            <button className="btn btn-sm btn-primary" onClick={handleBulkReassign} disabled={bulkBusy || !bulkAssignee}>
              Apply
            </button>
            <select value={bulkStage} onChange={(e) => setBulkStage(e.target.value)} className="form-select" disabled={bulkBusy}>
              <option value="">Move to stage…</option>
              {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button className="btn btn-sm btn-primary" onClick={handleBulkStageMove} disabled={bulkBusy || !bulkStage}>
              Apply
            </button>
            <button className="btn btn-sm btn-danger" onClick={handleBulkDelete} disabled={bulkBusy}>
              <Trash2 size={14} /> Delete
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => setSelectedIds(new Set())} disabled={bulkBusy}>
              Clear
            </button>
          </div>
        </div>
      )}

      {dueFollowUps.length > 0 && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '12px 14px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <AlertCircle size={16} style={{ color: '#c2410c' }} />
            <strong style={{ color: '#9a3412', fontSize: '13px' }}>
              {dueFollowUps.length} follow-up{dueFollowUps.length === 1 ? '' : 's'} due
            </strong>
            <button
              onClick={() => setShowOnlyDue(v => !v)}
              style={{
                background: showOnlyDue ? '#c2410c' : 'white', color: showOnlyDue ? 'white' : '#c2410c',
                border: '1px solid #c2410c', borderRadius: '999px', padding: '3px 10px',
                fontSize: '11px', fontWeight: 600, cursor: 'pointer'
              }}
            >
              {showOnlyDue ? 'Show all' : 'Show only due'}
            </button>
            <button
              onClick={() => setDueExpanded(v => !v)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#9a3412', fontSize: '12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              {dueExpanded ? 'Collapse' : 'Expand'}
              {dueExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
          {dueExpanded && (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {dueFollowUps.map(s => {
                const status = followUpStatus(s.next_follow_up_date)
                return (
                  <button
                    key={s.id}
                    onClick={() => setEditingSeller(s)}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 10px', textAlign: 'left', background: 'white', border: '1px solid #fed7aa', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '13px', color: '#111827' }}>{s.name}</span>
                    {s.business_name && <span style={{ fontSize: '12px', color: '#6b7280' }}>{s.business_name}</span>}
                    {status && (
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '999px', background: status.color + '22', color: status.color }}>
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
          Loading sellers…
        </div>
      ) : isMobile ? (
        <MobileSellerList
          stages={STAGES}
          sellersInStage={sellersInStage}
          peopleById={peopleById}
          onEdit={setEditingSeller}
          onDelete={handleDelete}
          onMove={handleMove}
        />
      ) : (
        <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px' }}>
          {STAGES.map(stage => {
            const items = sellersInStage(stage.key)
            return (
              <div
                key={stage.key}
                onDragOver={handleDragOver}
                onDrop={e => handleDrop(e, stage.key)}
                style={{ flex: '0 0 280px', background: '#f9fafb', borderRadius: '8px', padding: '12px', minHeight: '300px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: stage.color }}></span>
                  <strong style={{ fontSize: '13px', color: '#111827' }}>{stage.label}</strong>
                  <span style={{ fontSize: '11px', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{items.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {items.map(s => (
                    <SellerCard
                      key={s.id}
                      seller={s}
                      owner={peopleById[s.assigned_to]}
                      creator={peopleById[s.created_by]}
                      onEdit={() => setEditingSeller(s)}
                      onDelete={() => handleDelete(s.id)}
                      onDragStart={handleDragStart}
                      selected={selectedIds.has(s.id)}
                      onToggleSelect={() => toggleSelect(s.id)}
                    />
                  ))}
                  {items.length === 0 && (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
                      Drag a seller here
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(showAddForm || editingSeller) && (
        <SellerForm
          seller={editingSeller}
          people={people || []}
          onClose={() => { setShowAddForm(false); setEditingSeller(null) }}
          onSave={async (formData) => {
            try {
              if (editingSeller) {
                await updateSeller(editingSeller.id, formData)
                toast.success('Seller updated')
              } else {
                await createSeller(formData, currentPerson?.id)
                toast.success('Seller added')
              }
              setShowAddForm(false)
              setEditingSeller(null)
              loadSellers()
            } catch (err) {
              console.error('Failed to save seller:', err)
              toast.error('Failed to save: ' + err.message)
            }
          }}
        />
      )}
    </div>
  )
}

function SellerMeta({ seller }) {
  const line = [seller.business_name, seller.industry, seller.location].filter(Boolean).join(' · ')
  const money = [seller.asking_price && `Ask: ${seller.asking_price}`, seller.revenue && `Rev: ${seller.revenue}`].filter(Boolean).join(' · ')
  return (
    <>
      {line && <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>{line}</div>}
      {money && <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>{money}</div>}
    </>
  )
}

function SellerCard({ seller, owner, creator, onEdit, onDelete, onDragStart, selected, onToggleSelect }) {
  const followUp = followUpStatus(seller.next_follow_up_date)
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, seller)}
      onClick={onEdit}
      style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px 12px', cursor: 'grab', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={onToggleSelect}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={`Select ${seller.name || 'seller'}`}
              style={{ width: '14px', height: '14px', flexShrink: 0, cursor: 'pointer' }}
            />
          )}
          <div style={{ fontWeight: 600, fontSize: '13px', color: '#111827', lineHeight: 1.3 }}>{seller.name}</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Delete"
          style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '2px' }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <SellerMeta seller={seller} />

      {creator?.name && (
        <div style={{ fontSize: '10px', color: '#9ca3af', fontStyle: 'italic', marginBottom: '4px' }}>
          Added by {creator.name}
        </div>
      )}

      {seller.meeting_date && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '6px', marginRight: '6px', fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '999px', background: '#eff6ff', color: '#1d4ed8' }}>
          <Calendar size={10} /> Met {seller.meeting_date}
        </div>
      )}

      {followUp && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '6px', fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '999px', background: followUp.color + '22', color: followUp.color }}>
          <Calendar size={10} /> {followUp.label}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {owner && (
          <span title={owner.name} style={{ fontSize: '9px', fontWeight: 700, color: 'white', background: '#6366f1', borderRadius: '999px', padding: '2px 6px' }}>
            {initials(owner.name)}
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          {seller.url && (
            <a href={seller.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: '#6b7280' }} title={seller.url}>
              <ExternalLink size={11} />
            </a>
          )}
        </span>
      </div>
    </div>
  )
}

// Mobile: stacked stage sections with a Stage select per card instead of a
// horizontal kanban — matches the Partners board pattern.
function MobileSellerList({ stages, sellersInStage, peopleById, onEdit, onDelete, onMove }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {stages.map(stage => {
        const items = sellersInStage(stage.key)
        if (items.length === 0) return null
        return (
          <div key={stage.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', padding: '0 4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: stage.color }} />
              <strong style={{ fontSize: '13px', color: '#111827' }}>{stage.label}</strong>
              <span style={{ fontSize: '11px', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map(s => (
                <div
                  key={s.id}
                  onClick={() => onEdit(s)}
                  style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 14px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '6px' }}>
                    <div style={{ fontWeight: 600, fontSize: '15px', color: '#111827', lineHeight: 1.3 }}>{s.name}</div>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(s.id) }}
                      title="Delete"
                      style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '4px' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <SellerMeta seller={s} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between', marginTop: '8px' }}>
                    <select
                      value={s.stage}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => { e.stopPropagation(); onMove(s, e.target.value) }}
                      style={{ flex: 1, fontSize: '12px', padding: '6px 8px' }}
                    >
                      {stages.map(st => (
                        <option key={st.key} value={st.key}>Move to: {st.label}</option>
                      ))}
                    </select>
                    {peopleById[s.assigned_to] && (
                      <span title={peopleById[s.assigned_to].name} style={{ fontSize: '10px', fontWeight: 700, color: 'white', background: '#6366f1', borderRadius: '999px', padding: '3px 7px' }}>
                        {initials(peopleById[s.assigned_to].name)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SellerForm({ seller, people, onClose, onSave }) {
  const [form, setForm] = useState({
    name: seller?.name || '',
    business_name: seller?.business_name || '',
    industry: seller?.industry || '',
    location: seller?.location || '',
    stage: seller?.stage || 'sourced',
    url: seller?.url || '',
    email: seller?.email || '',
    asking_price: seller?.asking_price || '',
    revenue: seller?.revenue || '',
    meeting_date: seller?.meeting_date || '',
    next_follow_up_date: seller?.next_follow_up_date || '',
    last_contact_date: seller?.last_contact_date || '',
    assigned_to: seller?.assigned_to ? String(seller.assigned_to) : '',
    notes: seller?.notes || ''
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
      // Normalize empties: dates must be null (not '') for a DATE column, and
      // assigned_to must be an integer or null for the FK.
      for (const k of ['meeting_date', 'next_follow_up_date', 'last_contact_date']) {
        if (!payload[k]) payload[k] = null
      }
      payload.assigned_to = payload.assigned_to ? parseInt(payload.assigned_to, 10) : null
      await onSave(payload)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
        <h2>{seller ? 'Edit Seller' : 'Add Seller'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Contact Name *</label>
              <input type="text" value={form.name} onChange={e => update('name', e.target.value)} placeholder="e.g. Rohan Mehta" required autoFocus />
            </div>
            <div className="form-group">
              <label>Business Name</label>
              <input type="text" value={form.business_name} onChange={e => update('business_name', e.target.value)} placeholder="e.g. Mehta Foods Pvt Ltd" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Industry</label>
              <input type="text" value={form.industry} onChange={e => update('industry', e.target.value)} placeholder="e.g. D2C, SaaS, Manufacturing" />
            </div>
            <div className="form-group">
              <label>Location</label>
              <input type="text" value={form.location} onChange={e => update('location', e.target.value)} placeholder="e.g. Mumbai, Bangalore" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Stage</label>
              <select value={form.stage} onChange={e => update('stage', e.target.value)}>
                {STAGES.map(s => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Owner</label>
              <select value={form.assigned_to} onChange={e => update('assigned_to', e.target.value)}>
                <option value="">Unassigned</option>
                {people.map(p => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Asking Price</label>
              <input type="text" value={form.asking_price} onChange={e => update('asking_price', e.target.value)} placeholder="e.g. ₹5 Cr" />
            </div>
            <div className="form-group">
              <label>Revenue / SDE</label>
              <input type="text" value={form.revenue} onChange={e => update('revenue', e.target.value)} placeholder="e.g. ₹2 Cr rev, ₹60L SDE" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Website / LinkedIn</label>
              <input type="url" value={form.url} onChange={e => update('url', e.target.value)} placeholder="https://..." />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="contact@example.com" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Meeting Date</label>
              <input type="date" value={form.meeting_date} onChange={e => update('meeting_date', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Last Contact</label>
              <input type="date" value={form.last_contact_date} onChange={e => update('last_contact_date', e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label>Next Follow-up</label>
            <input type="date" value={form.next_follow_up_date} onChange={e => update('next_follow_up_date', e.target.value)} />
          </div>

          <div className="form-group">
            <label>Notes</label>
            <textarea value={form.notes} onChange={e => update('notes', e.target.value)} rows={4} placeholder="Deal context, what they're selling, conversation notes, etc." />
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving...' : seller ? 'Update' : 'Add Seller'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default SellersBoard
