import { useState, useEffect, useMemo } from 'react'
import { getItalyPipeline, createItalyContact, updateItalyContact, moveItalyContact, deleteItalyContact } from '../lib/crm-api'
import { useApp } from '../App'
import { useToast } from '../components/Toast'
import { useSessionState } from '../hooks/useSessionState'
import { useIsMobileDevice } from '../hooks/useIsMobileDevice'
import { Plus, Search, Trash2, ExternalLink, Calendar, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { istToday } from '../lib/dateUtils'
import { runBulk } from '../lib/bulkActions'

const todayStr = istToday

// Italy mixed-ecosystem buyside pipeline. Deliberately separate from the
// sales leads board and from the Indian sellers board — this one holds
// sellers, buyers, brokers, and other ecosystem contacts together, so the
// stages below are generic on purpose ("Acquired" doesn't fit a broker).
const CONTACT_TYPES = [
  { key: 'seller', label: 'Seller', color: '#a78bfa' },
  { key: 'buyer',  label: 'Buyer',  color: '#60a5fa' },
  { key: 'broker', label: 'Broker', color: '#f97316' },
  { key: 'other',  label: 'Other',  color: '#9ca3af' },
]
const CONTACT_TYPE_BY_KEY = Object.fromEntries(CONTACT_TYPES.map(t => [t.key, t]))

const STAGES = [
  { key: 'sourced',   label: 'Sourced',   color: '#a78bfa' },
  { key: 'contacted', label: 'Contacted', color: '#60a5fa' },
  { key: 'engaged',   label: 'Engaged',   color: '#06b6d4' },
  { key: 'active',    label: 'Active',    color: '#fbbf24' },
  { key: 'closed',    label: 'Closed',    color: '#22c55e' },
  { key: 'passed',    label: 'Passed',    color: '#9ca3af' },
]

// Terminal stages don't need follow-up nudges.
const TERMINAL_STAGES = new Set(['closed', 'passed'])

// Days until / since a YYYY-MM-DD date relative to today. Negative = overdue.
function daysUntil(dateStr) {
  if (!dateStr) return null
  const today = new Date(todayStr() + 'T00:00:00')
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  return Math.round((d - today) / (1000 * 60 * 60 * 24))
}

// Bucket a contact's follow-up date for badges + the due-list at the top.
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

function ItalyBoard() {
  const { currentPerson, people } = useApp()
  const { toast } = useToast()
  const isMobile = useIsMobileDevice()
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingContact, setEditingContact] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [draggedContact, setDraggedContact] = useState(null)
  const [showOnlyDue, setShowOnlyDue] = useSessionState('ib:showOnlyDue', false)
  const [dueExpanded, setDueExpanded] = useSessionState('ib:dueExpanded', false)
  const [searchQuery, setSearchQuery] = useSessionState('ib:searchQuery', '')
  const [typeFilter, setTypeFilter] = useSessionState('ib:typeFilter', '')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkAssignee, setBulkAssignee] = useState('')
  const [bulkStage, setBulkStage] = useState('')

  const peopleById = useMemo(
    () => Object.fromEntries((people || []).map(p => [p.id, p])),
    [people]
  )

  useEffect(() => {
    loadContacts()
  }, [])

  async function loadContacts() {
    setLoading(true)
    try {
      const data = await getItalyPipeline()
      setContacts(data)
    } catch (err) {
      console.error('Failed to load Italy pipeline:', err)
      toast.error('Failed to load Italy pipeline')
    } finally {
      setLoading(false)
    }
  }

  // Contacts whose follow-up is due today or earlier, oldest first.
  const dueFollowUps = useMemo(() => {
    return contacts
      .filter(c => {
        if (TERMINAL_STAGES.has(c.stage)) return false
        const days = daysUntil(c.next_follow_up_date)
        return days !== null && days <= 0
      })
      .sort((a, b) => String(a.next_follow_up_date).localeCompare(String(b.next_follow_up_date)))
  }, [contacts])

  const typeCounts = useMemo(() => {
    const counts = Object.fromEntries(CONTACT_TYPES.map(t => [t.key, 0]))
    for (const c of contacts) if (counts[c.contact_type] !== undefined) counts[c.contact_type]++
    return counts
  }, [contacts])

  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const dueIds = new Set(dueFollowUps.map(c => c.id))
    return contacts.filter(c => {
      if (showOnlyDue && !dueIds.has(c.id)) return false
      if (typeFilter && c.contact_type !== typeFilter) return false
      if (!q) return true
      return (
        (c.name || '').toLowerCase().includes(q) ||
        (c.company_name || '').toLowerCase().includes(q) ||
        (c.industry || '').toLowerCase().includes(q) ||
        (c.location || '').toLowerCase().includes(q) ||
        (c.notes || '').toLowerCase().includes(q)
      )
    })
  }, [contacts, searchQuery, showOnlyDue, dueFollowUps, typeFilter])

  function contactsInStage(stage) {
    return filteredContacts.filter(c => c.stage === stage)
  }

  // Drop any selected id that's scrolled out of the filtered set.
  useEffect(() => {
    const visible = new Set(filteredContacts.map(c => c.id))
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [filteredContacts])

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    const ids = filteredContacts.map(c => c.id)
    setSelectedIds(prev => {
      const allSelected = ids.length > 0 && ids.every(id => prev.has(id))
      return allSelected ? new Set() : new Set(ids)
    })
  }

  async function handleBulkReassign() {
    if (!selectedIds.size || !bulkAssignee) return
    setBulkBusy(true)
    try {
      const targets = filteredContacts.filter(c => selectedIds.has(c.id))
      const { succeeded, failed } = await runBulk(targets, c => updateItalyContact(c.id, { assigned_to: parseInt(bulkAssignee, 10) }))
      toast.success(`Reassigned ${succeeded.length} contact${succeeded.length === 1 ? '' : 's'}`)
      if (failed.length) toast.error(`${failed.length} failed to reassign`)
      setSelectedIds(new Set())
      setBulkAssignee('')
      await loadContacts()
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
      const targets = filteredContacts.filter(c => selectedIds.has(c.id))
      const { succeeded, failed } = await runBulk(targets, c => moveItalyContact(c.id, bulkStage))
      toast.success(`Moved ${succeeded.length} contact${succeeded.length === 1 ? '' : 's'}`)
      if (failed.length) toast.error(`${failed.length} failed to move`)
      setSelectedIds(new Set())
      setBulkStage('')
      await loadContacts()
    } catch (err) {
      console.error('Bulk stage move failed:', err)
      toast.error('Bulk move failed: ' + err.message)
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleBulkDelete() {
    if (!selectedIds.size) return
    if (!confirm(`Delete ${selectedIds.size} contact${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`)) return
    setBulkBusy(true)
    try {
      const targets = filteredContacts.filter(c => selectedIds.has(c.id))
      const { succeeded, failed } = await runBulk(targets, c => deleteItalyContact(c.id))
      toast.success(`Deleted ${succeeded.length} contact${succeeded.length === 1 ? '' : 's'}`)
      if (failed.length) toast.error(`${failed.length} failed to delete`)
      setSelectedIds(new Set())
      await loadContacts()
    } catch (err) {
      console.error('Bulk delete failed:', err)
      toast.error('Bulk delete failed: ' + err.message)
    } finally {
      setBulkBusy(false)
    }
  }

  function handleDragStart(e, contact) {
    setDraggedContact(contact)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  async function handleDrop(e, newStage) {
    e.preventDefault()
    if (!draggedContact || draggedContact.stage === newStage) {
      setDraggedContact(null)
      return
    }
    const prev = contacts
    setContacts(prev.map(c => c.id === draggedContact.id ? { ...c, stage: newStage } : c))
    setDraggedContact(null)
    try {
      await moveItalyContact(draggedContact.id, newStage)
    } catch (err) {
      console.error('Failed to move contact:', err)
      toast.error('Failed to move contact')
      setContacts(prev)
    }
  }

  async function handleMove(contact, newStage) {
    const prev = contacts
    setContacts(prev.map(c => c.id === contact.id ? { ...c, stage: newStage } : c))
    try {
      await moveItalyContact(contact.id, newStage)
    } catch (err) {
      console.error('Failed to move contact:', err)
      toast.error('Failed to move')
      setContacts(prev)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this contact?')) return
    const prev = contacts
    setContacts(prev.filter(c => c.id !== id))
    try {
      await deleteItalyContact(id)
      toast.success('Contact deleted')
    } catch (err) {
      console.error('Failed to delete contact:', err)
      toast.error('Failed to delete')
      setContacts(prev)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0 }}>Italy Pipeline</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0 0' }}>Sellers, buyers, brokers, and other ecosystem contacts for Italy</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
          <Plus size={16} /> Add Contact
        </button>
      </div>

      <div className="card" style={{ padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input
            type="text"
            placeholder="Search by name, company, industry, or notes..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="form-control"
            style={{ paddingLeft: '34px', fontSize: '13px' }}
          />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="form-select" style={{ fontSize: '13px' }}>
          <option value="">All types</option>
          {CONTACT_TYPES.map(t => (
            <option key={t.key} value={t.key}>{t.label} ({typeCounts[t.key] || 0})</option>
          ))}
        </select>
        <button className="btn btn-sm btn-secondary" onClick={toggleSelectAll} disabled={filteredContacts.length === 0}>
          {filteredContacts.length > 0 && filteredContacts.every(c => selectedIds.has(c.id)) ? 'Deselect all' : 'Select all shown'}
        </button>
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#6b7280' }}>
          <strong style={{ color: '#111827' }}>{filteredContacts.length}</strong> shown
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
            {selectedIds.size} contact{selectedIds.size === 1 ? '' : 's'} selected
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
              {dueFollowUps.map(c => {
                const status = followUpStatus(c.next_follow_up_date)
                return (
                  <button
                    key={c.id}
                    onClick={() => setEditingContact(c)}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 10px', textAlign: 'left', background: 'white', border: '1px solid #fed7aa', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '13px', color: '#111827' }}>{c.name}</span>
                    {c.company_name && <span style={{ fontSize: '12px', color: '#6b7280' }}>{c.company_name}</span>}
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
          Loading Italy pipeline…
        </div>
      ) : isMobile ? (
        <MobileContactList
          stages={STAGES}
          contactsInStage={contactsInStage}
          peopleById={peopleById}
          onEdit={setEditingContact}
          onDelete={handleDelete}
          onMove={handleMove}
        />
      ) : (
        <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px' }}>
          {STAGES.map(stage => {
            const items = contactsInStage(stage.key)
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
                  {items.map(c => (
                    <ContactCard
                      key={c.id}
                      contact={c}
                      owner={peopleById[c.assigned_to]}
                      creator={peopleById[c.created_by]}
                      onEdit={() => setEditingContact(c)}
                      onDelete={() => handleDelete(c.id)}
                      onDragStart={handleDragStart}
                      selected={selectedIds.has(c.id)}
                      onToggleSelect={() => toggleSelect(c.id)}
                    />
                  ))}
                  {items.length === 0 && (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
                      Drag a contact here
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(showAddForm || editingContact) && (
        <ContactForm
          contact={editingContact}
          people={people || []}
          onClose={() => { setShowAddForm(false); setEditingContact(null) }}
          onSave={async (formData) => {
            try {
              if (editingContact) {
                await updateItalyContact(editingContact.id, formData)
                toast.success('Contact updated')
              } else {
                await createItalyContact(formData, currentPerson?.id)
                toast.success('Contact added')
              }
              setShowAddForm(false)
              setEditingContact(null)
              loadContacts()
            } catch (err) {
              console.error('Failed to save contact:', err)
              toast.error('Failed to save: ' + err.message)
            }
          }}
        />
      )}
    </div>
  )
}

function TypeBadge({ type }) {
  const t = CONTACT_TYPE_BY_KEY[type]
  if (!t) return null
  return (
    <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '999px', background: t.color + '22', color: t.color }}>
      {t.label}
    </span>
  )
}

function ContactMeta({ contact }) {
  const line = [contact.company_name, contact.industry, contact.location].filter(Boolean).join(' · ')
  const money = [contact.deal_value && `Deal: ${contact.deal_value}`, contact.revenue && `Rev: ${contact.revenue}`].filter(Boolean).join(' · ')
  return (
    <>
      {line && <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>{line}</div>}
      {money && <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>{money}</div>}
    </>
  )
}

function ContactCard({ contact, owner, creator, onEdit, onDelete, onDragStart, selected, onToggleSelect }) {
  const followUp = followUpStatus(contact.next_follow_up_date)
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, contact)}
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
              aria-label={`Select ${contact.name || 'contact'}`}
              style={{ width: '14px', height: '14px', flexShrink: 0, cursor: 'pointer' }}
            />
          )}
          <div style={{ fontWeight: 600, fontSize: '13px', color: '#111827', lineHeight: 1.3 }}>{contact.name}</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Delete"
          style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '2px' }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div style={{ marginBottom: '4px' }}>
        <TypeBadge type={contact.contact_type} />
      </div>

      <ContactMeta contact={contact} />

      {creator?.name && (
        <div style={{ fontSize: '10px', color: '#9ca3af', fontStyle: 'italic', marginBottom: '4px' }}>
          Added by {creator.name}
        </div>
      )}

      {contact.meeting_date && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '6px', marginRight: '6px', fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '999px', background: '#eff6ff', color: '#1d4ed8' }}>
          <Calendar size={10} /> Met {contact.meeting_date}
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
          {contact.url && (
            <a href={contact.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: '#6b7280' }} title={contact.url}>
              <ExternalLink size={11} />
            </a>
          )}
        </span>
      </div>
    </div>
  )
}

// Mobile: stacked stage sections with a Stage select per card instead of a
// horizontal kanban — matches the Sellers/Partners board pattern.
function MobileContactList({ stages, contactsInStage, peopleById, onEdit, onDelete, onMove }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {stages.map(stage => {
        const items = contactsInStage(stage.key)
        if (items.length === 0) return null
        return (
          <div key={stage.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', padding: '0 4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: stage.color }} />
              <strong style={{ fontSize: '13px', color: '#111827' }}>{stage.label}</strong>
              <span style={{ fontSize: '11px', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map(c => (
                <div
                  key={c.id}
                  onClick={() => onEdit(c)}
                  style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 14px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '6px' }}>
                    <div style={{ fontWeight: 600, fontSize: '15px', color: '#111827', lineHeight: 1.3 }}>{c.name}</div>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(c.id) }}
                      title="Delete"
                      style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '4px' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div style={{ marginBottom: '4px' }}>
                    <TypeBadge type={c.contact_type} />
                  </div>
                  <ContactMeta contact={c} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between', marginTop: '8px' }}>
                    <select
                      value={c.stage}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => { e.stopPropagation(); onMove(c, e.target.value) }}
                      style={{ flex: 1, fontSize: '12px', padding: '6px 8px' }}
                    >
                      {stages.map(st => (
                        <option key={st.key} value={st.key}>Move to: {st.label}</option>
                      ))}
                    </select>
                    {peopleById[c.assigned_to] && (
                      <span title={peopleById[c.assigned_to].name} style={{ fontSize: '10px', fontWeight: 700, color: 'white', background: '#6366f1', borderRadius: '999px', padding: '3px 7px' }}>
                        {initials(peopleById[c.assigned_to].name)}
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

function ContactForm({ contact, people, onClose, onSave }) {
  const [form, setForm] = useState({
    name: contact?.name || '',
    contact_type: contact?.contact_type || 'seller',
    company_name: contact?.company_name || '',
    industry: contact?.industry || '',
    location: contact?.location || '',
    stage: contact?.stage || 'sourced',
    url: contact?.url || '',
    email: contact?.email || '',
    deal_value: contact?.deal_value || '',
    revenue: contact?.revenue || '',
    meeting_date: contact?.meeting_date || '',
    next_follow_up_date: contact?.next_follow_up_date || '',
    last_contact_date: contact?.last_contact_date || '',
    assigned_to: contact?.assigned_to ? String(contact.assigned_to) : '',
    notes: contact?.notes || ''
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
        <h2>{contact ? 'Edit Contact' : 'Add Contact'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Contact Name *</label>
              <input type="text" value={form.name} onChange={e => update('name', e.target.value)} placeholder="e.g. Giulia Russo" required autoFocus />
            </div>
            <div className="form-group">
              <label>Type</label>
              <select value={form.contact_type} onChange={e => update('contact_type', e.target.value)}>
                {CONTACT_TYPES.map(t => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Company Name</label>
              <input type="text" value={form.company_name} onChange={e => update('company_name', e.target.value)} placeholder="e.g. Russo Group Srl" />
            </div>
            <div className="form-group">
              <label>Industry</label>
              <input type="text" value={form.industry} onChange={e => update('industry', e.target.value)} placeholder="e.g. Manufacturing, SaaS" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Location</label>
              <input type="text" value={form.location} onChange={e => update('location', e.target.value)} placeholder="e.g. Milan, Rome" />
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
              <label>Owner</label>
              <select value={form.assigned_to} onChange={e => update('assigned_to', e.target.value)}>
                <option value="">Unassigned</option>
                {people.map(p => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="contact@example.com" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Deal Value</label>
              <input type="text" value={form.deal_value} onChange={e => update('deal_value', e.target.value)} placeholder="Asking price, budget, or typical deal size" />
            </div>
            <div className="form-group">
              <label>Revenue / SDE</label>
              <input type="text" value={form.revenue} onChange={e => update('revenue', e.target.value)} placeholder="e.g. €2M rev" />
            </div>
          </div>

          <div className="form-group">
            <label>Website / LinkedIn</label>
            <input type="url" value={form.url} onChange={e => update('url', e.target.value)} placeholder="https://..." />
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
            <textarea value={form.notes} onChange={e => update('notes', e.target.value)} rows={4} placeholder="Deal context, relationship notes, etc." />
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving...' : contact ? 'Update' : 'Add Contact'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ItalyBoard
