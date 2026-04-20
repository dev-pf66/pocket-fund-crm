import { useState, useEffect, useMemo, useRef } from 'react'
import { useApp } from '../App'
import {
  getOutreachQueue,
  bulkCreateLeads,
  markLeadReachedOut,
  updateLead,
  deleteLead
} from '../lib/crm-api'
import { isLinkedInUrl } from '../lib/linkedin'
import { useToast } from '../components/Toast'
import {
  Inbox,
  Plus,
  Upload,
  Check,
  Trash2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  X
} from 'lucide-react'

const UNBATCHED_KEY = '__unbatched__'

function OutreachQueue() {
  const { currentPerson } = useApp()
  const { toast } = useToast()
  const [leads, setLeads] = useState([])
  const [batchStats, setBatchStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [collapsed, setCollapsed] = useState({})
  const [pendingId, setPendingId] = useState(null)

  useEffect(() => {
    if (currentPerson?.id) loadQueue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPerson?.id])

  async function loadQueue() {
    setLoading(true)
    try {
      const { leads: data, batchStats: stats } = await getOutreachQueue(currentPerson.id)
      setLeads(data)
      setBatchStats(stats)
    } catch (err) {
      console.error('Failed to load queue:', err)
      toast.error('Failed to load outreach queue')
    } finally {
      setLoading(false)
    }
  }

  // Group leads by batch; batchless leads go into a synthetic "Unbatched" group.
  const grouped = useMemo(() => {
    const groups = new Map()
    for (const lead of leads) {
      const key = lead.import_batch_id || UNBATCHED_KEY
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          batchId: lead.import_batch_id || null,
          label: lead.import_batch_label || null,
          createdAt: lead.created_at,
          leads: []
        })
      }
      groups.get(key).leads.push(lead)
      const existing = groups.get(key)
      if (lead.created_at > existing.createdAt) existing.createdAt = lead.created_at
    }
    return [...groups.values()].sort((a, b) => {
      if (a.key === UNBATCHED_KEY) return 1
      if (b.key === UNBATCHED_KEY) return -1
      return (b.createdAt || '').localeCompare(a.createdAt || '')
    })
  }, [leads])

  async function handleMarkReachedOut(lead) {
    setPendingId(lead.id)
    try {
      await markLeadReachedOut(lead, currentPerson.id, currentPerson.name)
      setLeads(prev => prev.filter(l => l.id !== lead.id))
      if (lead.import_batch_id) {
        setBatchStats(prev => {
          const cur = prev[lead.import_batch_id]
          if (!cur) return prev
          return {
            ...prev,
            [lead.import_batch_id]: { ...cur, contacted: cur.contacted + 1 }
          }
        })
      }
      toast.success(`Logged DM to ${lead.name}`)
    } catch (err) {
      console.error('Failed to mark reached out:', err)
      toast.error('Failed: ' + err.message)
    } finally {
      setPendingId(null)
    }
  }

  async function handleFirmUpdate(lead, firmName) {
    if ((lead.firm_name || '') === firmName) return
    try {
      await updateLead(lead.id, { firm_name: firmName })
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, firm_name: firmName } : l))
    } catch (err) {
      console.error('Failed to update firm:', err)
      toast.error('Failed to save firm name')
    }
  }

  async function handleDelete(lead) {
    if (!confirm(`Remove "${lead.name}" from the queue? This deletes the lead entirely.`)) return
    setPendingId(lead.id)
    try {
      await deleteLead(lead.id)
      setLeads(prev => prev.filter(l => l.id !== lead.id))
      if (lead.import_batch_id) {
        setBatchStats(prev => {
          const cur = prev[lead.import_batch_id]
          if (!cur) return prev
          return {
            ...prev,
            [lead.import_batch_id]: { ...cur, total: Math.max(0, cur.total - 1) }
          }
        })
      }
      toast.success(`Removed ${lead.name}`)
    } catch (err) {
      console.error('Failed to delete lead:', err)
      toast.error('Failed to delete lead')
    } finally {
      setPendingId(null)
    }
  }

  function toggleCollapsed(key) {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
  }

  async function handleBulkAddResult(result) {
    const { added, skipped } = result
    if (added === 0 && skipped === 0) {
      toast.warn('No valid LinkedIn URLs found')
      return
    }
    if (added === 0) {
      toast.warn(`Nothing added — all ${skipped} URLs were duplicates`)
      return
    }
    toast.success(
      skipped > 0
        ? `Added ${added} · skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}`
        : `Added ${added} lead${added === 1 ? '' : 's'} to your queue`
    )
    setShowAddModal(false)
    await loadQueue()
  }

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
            <Inbox size={24} /> Outreach Queue
          </h1>
          <p style={{ color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
            Work through leads you haven't contacted yet.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          <Plus size={16} /> Paste or upload list
        </button>
      </div>

      {loading ? (
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 12px' }}></div>
          Loading queue…
        </div>
      ) : grouped.length === 0 ? (
        <div className="card" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <Inbox size={40} style={{ color: '#9ca3af', marginBottom: '12px' }} />
          <h3 style={{ margin: '0 0 6px', color: '#111827' }}>No leads in your queue</h3>
          <p style={{ color: '#6b7280', margin: '0 0 16px' }}>
            Paste a list of LinkedIn URLs to get started.
          </p>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={16} /> Paste or upload list
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {grouped.map(group => (
            <BatchGroup
              key={group.key}
              group={group}
              stats={group.batchId ? batchStats[group.batchId] : null}
              collapsed={!!collapsed[group.key]}
              onToggle={() => toggleCollapsed(group.key)}
              pendingId={pendingId}
              onMark={handleMarkReachedOut}
              onDelete={handleDelete}
              onFirmUpdate={handleFirmUpdate}
            />
          ))}
        </div>
      )}

      {showAddModal && (
        <BulkAddModal
          personId={currentPerson?.id}
          onClose={() => setShowAddModal(false)}
          onDone={handleBulkAddResult}
        />
      )}
    </div>
  )
}

function BatchGroup({ group, stats, collapsed, onToggle, pendingId, onMark, onDelete, onFirmUpdate }) {
  const isUnbatched = group.key === UNBATCHED_KEY
  const title = isUnbatched
    ? 'Uncategorized'
    : (group.label || `Batch from ${new Date(group.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`)
  const remaining = group.leads.length
  const total = stats?.total ?? remaining
  const contacted = stats?.contacted ?? 0
  const pct = total > 0 ? Math.round((contacted / total) * 100) : 0

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
          padding: '14px 18px', background: '#f9fafb', border: 'none',
          borderBottom: collapsed ? 'none' : '1px solid #e5e7eb', cursor: 'pointer',
          textAlign: 'left'
        }}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: '#111827', fontSize: '15px' }}>{title}</div>
          {!isUnbatched && stats && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
              <div style={{
                flex: 1, maxWidth: '260px', height: '6px', background: '#e5e7eb',
                borderRadius: '999px', overflow: 'hidden'
              }}>
                <div style={{
                  width: `${pct}%`, height: '100%', background: '#16a34a',
                  transition: 'width 0.3s'
                }} />
              </div>
              <span style={{ fontSize: '12px', color: '#6b7280' }}>
                {contacted} of {total} contacted
              </span>
            </div>
          )}
        </div>
        <span style={{ fontSize: '12px', color: '#6b7280', whiteSpace: 'nowrap' }}>
          {remaining} remaining
        </span>
      </button>

      {!collapsed && (
        <div style={{ padding: '10px' }}>
          {group.leads.map(lead => (
            <QueueRow
              key={lead.id}
              lead={lead}
              busy={pendingId === lead.id}
              onMark={() => onMark(lead)}
              onDelete={() => onDelete(lead)}
              onFirmUpdate={onFirmUpdate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function QueueRow({ lead, busy, onMark, onDelete, onFirmUpdate }) {
  const [firm, setFirm] = useState(lead.firm_name || '')

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '12px 10px', borderBottom: '1px solid #f3f4f6',
      opacity: busy ? 0.5 : 1
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, color: '#111827', fontSize: '14px' }}>
          {lead.name || 'Unknown'}
        </div>
        {lead.linkedin_url && (
          <a
            href={lead.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '12px', color: '#2563eb', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '2px'
            }}
          >
            <ExternalLink size={11} /> {shortenUrl(lead.linkedin_url)}
          </a>
        )}
      </div>
      <input
        type="text"
        value={firm}
        onChange={e => setFirm(e.target.value)}
        onBlur={() => onFirmUpdate(lead, firm.trim())}
        placeholder="Firm…"
        style={{
          width: '180px', padding: '6px 8px', fontSize: '13px',
          border: '1px solid #e5e7eb', borderRadius: '4px', background: '#fff'
        }}
      />
      <button
        className="btn btn-sm btn-primary"
        onClick={onMark}
        disabled={busy}
        title="Log LinkedIn outreach and move to Cold Outreach"
      >
        <Check size={14} /> Mark reached out
      </button>
      <button
        className="btn btn-sm"
        onClick={onDelete}
        disabled={busy}
        title="Remove from queue"
        style={{ color: '#dc2626' }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function BulkAddModal({ personId, onClose, onDone }) {
  const { toast } = useToast()
  const [label, setLabel] = useState(defaultBatchLabel())
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef(null)

  const urls = useMemo(() => extractLinkedInUrls(text), [text])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const content = await file.text()
      setText(prev => prev ? (prev.replace(/\s+$/, '') + '\n' + content) : content)
    } catch (err) {
      console.error('Failed to read file:', err)
      toast.error('Failed to read file: ' + err.message)
    }
    e.target.value = ''
  }

  async function handleSubmit() {
    if (urls.length === 0) return
    setSubmitting(true)
    try {
      const result = await bulkCreateLeads(urls, label, personId)
      onDone(result)
    } catch (err) {
      console.error('Bulk add failed:', err)
      toast.error('Failed to add leads: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ margin: 0 }}>Add leads in bulk</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
            <X size={20} />
          </button>
        </div>

        <div className="form-group">
          <label>Batch label (optional)</label>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="e.g. Apr 20 — PE firms"
          />
        </div>

        <div className="form-group">
          <label>LinkedIn URLs</label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'Paste one URL per line, or upload a CSV/TXT file.\n\nhttps://linkedin.com/in/john-smith\nhttps://linkedin.com/in/jane-doe-ab12\n…'}
            rows={10}
            style={{ fontFamily: 'monospace', fontSize: '13px' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={14} /> Upload CSV / TXT
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={handleFile}
              style={{ display: 'none' }}
            />
            <span style={{ fontSize: '12px', color: urls.length > 0 ? '#16a34a' : '#6b7280' }}>
              {urls.length > 0 ? `${urls.length} LinkedIn URL${urls.length === 1 ? '' : 's'} detected` : 'No LinkedIn URLs detected yet'}
            </span>
          </div>
        </div>

        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={submitting || urls.length === 0}
          >
            {submitting ? 'Adding…' : `Add ${urls.length || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  )
}

// Pull every LinkedIn URL out of a blob of text. Stop at common CSV/JSON
// separators so two URLs joined by "," don't get matched as one. Handles
// plain lists, CSV rows, or messy paste; dedupes within the input.
function extractLinkedInUrls(text) {
  if (!text) return []
  const matches = text.match(/https?:\/\/[^\s,;"'<>()]+/gi) || []
  const out = []
  const seen = new Set()
  for (const raw of matches) {
    if (!isLinkedInUrl(raw)) continue
    const norm = raw.toLowerCase()
    if (seen.has(norm)) continue
    seen.add(norm)
    out.push(raw)
  }
  return out
}

function shortenUrl(url) {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
}

function defaultBatchLabel() {
  const d = new Date()
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default OutreachQueue
