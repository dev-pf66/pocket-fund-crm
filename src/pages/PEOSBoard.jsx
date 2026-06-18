import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  getDemos, createDemo, updateDemo, moveDemo, deleteDemo,
  getLeads, createLead, findLeadByLinkedInUrl
} from '../lib/crm-api'
import { useApp } from '../App'
import { useToast } from '../components/Toast'
import { useSessionState } from '../hooks/useSessionState'
import { useIsMobileDevice } from '../hooks/useIsMobileDevice'
import { Plus, Search, Trash2, ExternalLink, Linkedin, Calendar, X } from 'lucide-react'
import { isLinkedInUrl, nameFromLinkedInUrl } from '../lib/linkedin'
import { istToday, istAddDays } from '../lib/dateUtils'

// Effective YYYY-MM-DD (IST) for a demo. Prefers the timed datetime,
// falls back to the date-only field. en-CA locale yields YYYY-MM-DD.
function demoDateStr(demo) {
  if (demo.demo_datetime) {
    const d = new Date(demo.demo_datetime)
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    }
  }
  if (demo.demo_date) return String(demo.demo_date).slice(0, 10)
  return null
}

const DATE_PRESETS = [
  { value: 'all',        label: 'All dates' },
  { value: 'today',      label: 'Today' },
  { value: 'upcoming',   label: 'Upcoming' },
  { value: 'next_7',     label: 'Next 7 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_7',     label: 'Last 7 days' },
  { value: 'last_30',    label: 'Last 30 days' },
  { value: 'custom',     label: 'Custom range' }
]

// Does a demo's effective date fall within the selected preset / range?
// Demos with no date are excluded whenever a date filter is active.
function demoMatchesDateFilter(demo, filter, from, to) {
  if (filter === 'all') return true
  const ds = demoDateStr(demo)
  if (!ds) return false
  const today = istToday()
  switch (filter) {
    case 'today':      return ds === today
    case 'upcoming':   return ds >= today
    case 'next_7':     return ds >= today && ds <= istAddDays(today, 7)
    case 'this_month': return ds.slice(0, 7) === today.slice(0, 7)
    case 'last_7':     return ds >= istAddDays(today, -7) && ds <= today
    case 'last_30':    return ds >= istAddDays(today, -30) && ds <= today
    case 'custom':
      if (from && ds < from) return false
      if (to && ds > to) return false
      return true
    default: return true
  }
}

const STAGES = [
  { key: 'scheduled',  label: 'Scheduled',  color: '#a78bfa' },
  { key: 'done',       label: 'Demo Done',  color: '#60a5fa' },
  { key: 'signed_up',  label: 'Signed Up',  color: '#22c55e' },
  { key: 'passed',     label: 'Passed',     color: '#9ca3af' }
]

// Canned scales for the demo form. Stored as plain strings so admins
// can extend them later without a schema change.
const FIRM_SIZE_OPTIONS = [
  '< $50M AUM',
  '$50M – $250M',
  '$250M – $1B',
  '$1B – $5B',
  '$5B+'
]

const TEAM_SIZE_OPTIONS = [
  '1 (solo)',
  '2 – 5',
  '6 – 10',
  '11 – 25',
  '26 – 50',
  '50+'
]

// keenness is a 1-5 int, rendered with a label so the meaning is obvious.
const KEENNESS_OPTIONS = [
  { value: 1, label: 'Cold' },
  { value: 2, label: 'Curious' },
  { value: 3, label: 'Interested' },
  { value: 4, label: 'Engaged' },
  { value: 5, label: 'Eager' }
]

function keennessColor(v) {
  if (v >= 5) return '#16a34a'
  if (v >= 4) return '#22c55e'
  if (v >= 3) return '#f59e0b'
  if (v >= 2) return '#f97316'
  return '#9ca3af'
}

// B2B sales context: what the firm already runs, when they'd decide, how
// much budget they have. Stored as raw strings / arrays — the UI maps to
// labels but the DB stays flexible so we can extend without a migration.
const CURRENT_TOOLS_OPTIONS = [
  'Excel', 'Affinity', 'DealCloud', 'Dynamo',
  'Salesforce', 'HubSpot', 'Notion', 'Airtable',
  'Custom', 'None', 'Other'
]

const DECISION_TIMELINE_OPTIONS = [
  { value: 'now',          label: 'Now',           color: '#dc2626' },
  { value: 'next_quarter', label: 'Next quarter',  color: '#d97706' },
  { value: 'next_6mo',     label: 'Next 6 months', color: '#ca8a04' },
  { value: 'no_rush',      label: 'No rush',       color: '#6b7280' }
]
const DECISION_TIMELINE_BY_VALUE = Object.fromEntries(
  DECISION_TIMELINE_OPTIONS.map(o => [o.value, o])
)

const BUDGET_SIGNAL_OPTIONS = [
  { value: 'no_budget',  label: 'No budget',  color: '#9ca3af' },
  { value: 'small',      label: 'Small',      color: '#60a5fa' },
  { value: 'mid',        label: 'Mid',        color: '#10b981' },
  { value: 'enterprise', label: 'Enterprise', color: '#16a34a' },
  { value: 'unknown',    label: 'Unknown',    color: '#9ca3af' }
]
const BUDGET_SIGNAL_BY_VALUE = Object.fromEntries(
  BUDGET_SIGNAL_OPTIONS.map(o => [o.value, o])
)

function fmtDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Format a UTC timestamp as "Apr 27, 3:30 PM IST". The CRM team operates
// in IST, so always render in Asia/Kolkata regardless of the browser's
// timezone — matches the rest of the app (dateUtils.js).
function fmtDateTimeIST(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata'
  }) + ' IST'
}

// For the form's <input type="datetime-local">, convert a UTC timestamp
// to the IST-equivalent local string ('YYYY-MM-DDTHH:mm') so the value
// the user typed comes back unchanged. Returns '' for null.
function toLocalIstInput(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  // Shift into IST then format. Don't use toISOString because that's UTC.
  const ist = new Date(d.getTime() + (5.5 * 60 * 60 * 1000) - (d.getTimezoneOffset() * 60 * 1000))
  return ist.toISOString().slice(0, 16)
}

// Convert a 'YYYY-MM-DDTHH:mm' string the user typed (assumed IST) back
// into a UTC ISO timestamp for storage.
function fromLocalIstInput(local) {
  if (!local) return null
  // The browser parses the datetime-local string as if it were local time,
  // so we'd get the user's browser tz. Reinterpret it as IST instead by
  // building the timestamp manually.
  const [datePart, timePart] = local.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = (timePart || '00:00').split(':').map(Number)
  // Date.UTC gives the UTC ms for that wall-clock time; subtract the IST
  // offset so the resulting timestamp represents that IST instant.
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - 5.5 * 60 * 60 * 1000).toISOString()
}

// Mirrors the helper in Layout.jsx.
const BOOTSTRAP_ADMIN_EMAIL = 'dev@pocket-fund.com'
function isAdminUser(person) {
  if (!person) return false
  return Boolean(person.is_admin) || person.email === BOOTSTRAP_ADMIN_EMAIL
}

function PEOSBoard() {
  const { currentPerson, people } = useApp()
  const { toast } = useToast()
  const isMobile = useIsMobileDevice()
  const isAdmin = isAdminUser(currentPerson)

  // Admin-only viewing scope. 'me' = own demos, 'all' = whole team
  // (admin default so they land on the team view immediately), otherwise
  // a specific person.id. Non-admins ignore this and stay scoped to
  // themselves via the RLS belt-and-braces.
  const [viewing, setViewing] = useSessionState('peos:viewing', 'all')
  const viewingPersonId = !isAdmin
    ? currentPerson?.id ?? null
    : viewing === 'me'
      ? currentPerson?.id ?? null
      : viewing === 'all'
        ? null
        : viewing
  const [demos, setDemos] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingDemo, setEditingDemo] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [draggedDemo, setDraggedDemo] = useState(null)

  const [searchQuery, setSearchQuery] = useSessionState('peos:searchQuery', '')
  const [dateFilter, setDateFilter] = useSessionState('peos:dateFilter', 'all')
  const [customFrom, setCustomFrom] = useSessionState('peos:customFrom', '')
  const [customTo, setCustomTo] = useSessionState('peos:customTo', '')

  useEffect(() => {
    loadDemos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPerson?.id, viewing, isAdmin])

  async function loadDemos() {
    if (!currentPerson?.id) return
    setLoading(true)
    try {
      // viewingPersonId is null when an admin selects 'Everyone' — getDemos
      // with no person filter returns all rows RLS permits.
      const data = await getDemos(viewingPersonId)
      setDemos(data)
    } catch (err) {
      console.error('Failed to load demos:', err)
      toast.error('Failed to load demos')
    } finally {
      setLoading(false)
    }
  }

  const filteredDemos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return demos.filter(d => {
      if (!demoMatchesDateFilter(d, dateFilter, customFrom, customTo)) return false
      if (!q) return true
      const name = d.lead?.name || ''
      const firm = d.lead?.firm_name || ''
      return (
        name.toLowerCase().includes(q) ||
        firm.toLowerCase().includes(q) ||
        (d.use_case || '').toLowerCase().includes(q) ||
        (d.feedback || '').toLowerCase().includes(q) ||
        (d.next_steps || '').toLowerCase().includes(q)
      )
    })
  }, [demos, searchQuery, dateFilter, customFrom, customTo])

  function demosInStage(stage) {
    const items = filteredDemos.filter(d => d.stage === stage)
    if (stage === 'scheduled') {
      // Soonest upcoming call at the top so the user sees what's next.
      // Falls back to demo_date when no datetime is set, then to created_at.
      return items.slice().sort((a, b) => {
        const ka = a.demo_datetime || a.demo_date || a.created_at
        const kb = b.demo_datetime || b.demo_date || b.created_at
        return String(ka).localeCompare(String(kb))
      })
    }
    return items
  }

  function handleDragStart(e, demo) {
    setDraggedDemo(demo)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  async function handleDrop(e, newStage) {
    e.preventDefault()
    if (!draggedDemo || draggedDemo.stage === newStage) {
      setDraggedDemo(null)
      return
    }
    const prev = demos
    setDemos(prev.map(d => d.id === draggedDemo.id ? { ...d, stage: newStage } : d))
    setDraggedDemo(null)
    try {
      await moveDemo(draggedDemo.id, newStage)
    } catch (err) {
      console.error('Failed to move demo:', err)
      toast.error('Failed to move demo')
      setDemos(prev)
    }
  }

  async function handleStageChange(demo, newStage) {
    if (demo.stage === newStage) return
    const prev = demos
    setDemos(prev.map(d => d.id === demo.id ? { ...d, stage: newStage } : d))
    try {
      await moveDemo(demo.id, newStage)
    } catch (err) {
      console.error('Failed to move demo:', err)
      toast.error('Failed to move')
      setDemos(prev)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this demo entry?')) return
    const prev = demos
    setDemos(prev.filter(d => d.id !== id))
    try {
      await deleteDemo(id)
      toast.success('Demo deleted')
    } catch (err) {
      console.error('Failed to delete demo:', err)
      toast.error('Failed to delete')
      setDemos(prev)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0 }}>PE OS</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0 0' }}>
            {isAdmin
              ? 'Demo calls for the PE OS product (admin can view any teammate)'
              : 'Demo calls for the PE OS product'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
          <Plus size={16} /> Add Demo
        </button>
      </div>

      {/* Admin-only team switcher. Matches the Outreach Log pattern. */}
      {isAdmin && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Viewing
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <ViewPill active={viewing === 'all'} onClick={() => setViewing('all')}>Everyone</ViewPill>
            <ViewPill active={viewing === 'me'} onClick={() => setViewing('me')}>Me</ViewPill>
            {(people || [])
              .filter(p => p.id !== currentPerson?.id)
              .map(p => (
                <ViewPill
                  key={p.id}
                  active={String(viewing) === String(p.id)}
                  onClick={() => setViewing(p.id)}
                >
                  {p.name}
                </ViewPill>
              ))}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input
            type="text"
            placeholder="Search by lead, firm, use case, feedback…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="form-control"
            style={{ paddingLeft: '34px', fontSize: '13px' }}
          />
        </div>

        <select
          value={dateFilter}
          onChange={e => setDateFilter(e.target.value)}
          className="form-control"
          style={{ width: 'auto', fontSize: '13px' }}
          title="Filter demos by date"
        >
          {DATE_PRESETS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>

        {dateFilter === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="form-control"
              style={{ width: 'auto', fontSize: '13px' }}
              title="From date"
            />
            <span style={{ color: '#9ca3af', fontSize: '12px' }}>–</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="form-control"
              style={{ width: 'auto', fontSize: '13px' }}
              title="To date"
            />
          </div>
        )}

        {(dateFilter !== 'all' || searchQuery) && (
          <button
            className="btn btn-sm"
            onClick={() => { setDateFilter('all'); setCustomFrom(''); setCustomTo(''); setSearchQuery('') }}
            title="Clear filters"
          >
            Clear
          </button>
        )}

        <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#6b7280' }}>
          <strong style={{ color: '#111827' }}>{filteredDemos.length}</strong> shown
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 12px' }}></div>
          Loading demos…
        </div>
      ) : isMobile ? (
        <MobileDemoList
          stages={STAGES}
          demosInStage={demosInStage}
          showCreator={isAdmin && viewing === 'all'}
          onEdit={setEditingDemo}
          onDelete={handleDelete}
          onStageChange={handleStageChange}
        />
      ) : (
        <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px' }}>
          {STAGES.map(stage => {
            const items = demosInStage(stage.key)
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
                  {items.map(d => (
                    <DemoCard
                      key={d.id}
                      demo={d}
                      showCreator={isAdmin && viewing === 'all'}
                      onEdit={() => setEditingDemo(d)}
                      onDelete={() => handleDelete(d.id)}
                      onDragStart={handleDragStart}
                    />
                  ))}
                  {items.length === 0 && (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
                      Drag a demo here
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(showAddForm || editingDemo) && (
        <DemoForm
          demo={editingDemo}
          currentPersonId={currentPerson?.id}
          onClose={() => { setShowAddForm(false); setEditingDemo(null) }}
          onSave={async (formData) => {
            try {
              if (editingDemo) {
                const updated = await updateDemo(editingDemo.id, formData)
                setDemos(prev => prev.map(d => d.id === updated.id ? updated : d))
                toast.success('Demo updated')
              } else {
                const created = await createDemo(formData, currentPerson.id)
                setDemos(prev => [created, ...prev])
                toast.success('Demo added')
              }
              setShowAddForm(false)
              setEditingDemo(null)
            } catch (err) {
              console.error('Failed to save demo:', err)
              toast.error('Failed to save: ' + err.message)
            }
          }}
        />
      )}
    </div>
  )
}

function DemoCard({ demo, showCreator = false, onEdit, onDelete, onDragStart }) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, demo)}
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
        <div style={{ flex: 1, minWidth: 0 }}>
          {demo.lead ? (
            <Link
              to={`/leads/${demo.lead.id}`}
              onClick={(e) => e.stopPropagation()}
              style={{ color: '#1d4ed8', fontWeight: 600, fontSize: '13px', textDecoration: 'none', lineHeight: 1.3 }}
            >
              {demo.lead.name}
            </Link>
          ) : (
            <div style={{ color: '#9ca3af', fontWeight: 600, fontSize: '13px' }}>No lead linked</div>
          )}
          {demo.lead?.firm_name && (
            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{demo.lead.firm_name}</div>
          )}
          {showCreator && demo.created_by_person?.name && (
            <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '2px', fontStyle: 'italic' }}>
              by {demo.created_by_person.name}
            </div>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Delete"
          style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '2px' }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
        {demo.demo_datetime ? (
          <span style={{ fontSize: '11px', color: '#374151', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Calendar size={11} /> {fmtDateTimeIST(demo.demo_datetime)}
          </span>
        ) : demo.demo_date ? (
          <span style={{ fontSize: '11px', color: '#374151', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Calendar size={11} /> {fmtDate(demo.demo_date)}
          </span>
        ) : null}
        {demo.calendar_invite_url && (
          <a
            href={demo.calendar_invite_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Open calendar invite"
            style={{ color: '#1d4ed8', display: 'inline-flex' }}
          >
            <ExternalLink size={11} />
          </a>
        )}
        {demo.keenness && (
          <span
            title={`Keenness: ${KEENNESS_OPTIONS.find(o => o.value === demo.keenness)?.label || demo.keenness}/5`}
            style={{
              fontSize: '10px', fontWeight: 600,
              padding: '1px 6px', borderRadius: '999px',
              background: keennessColor(demo.keenness) + '22',
              color: keennessColor(demo.keenness)
            }}
          >
            {demo.keenness}/5
          </span>
        )}
        {/* Only urgent decision-timeline values get a card pill — the
            non-urgent ones (next_6mo / no_rush) would just be noise. */}
        {(demo.decision_timeline === 'now' || demo.decision_timeline === 'next_quarter') && (
          <span
            title={`Decision timeline: ${DECISION_TIMELINE_BY_VALUE[demo.decision_timeline].label}`}
            style={{
              fontSize: '10px', fontWeight: 600,
              padding: '1px 6px', borderRadius: '999px',
              background: DECISION_TIMELINE_BY_VALUE[demo.decision_timeline].color + '22',
              color: DECISION_TIMELINE_BY_VALUE[demo.decision_timeline].color
            }}
          >
            {DECISION_TIMELINE_BY_VALUE[demo.decision_timeline].label}
          </span>
        )}
        {demo.firm_size && (
          <span style={{
            fontSize: '10px', color: '#6b7280',
            padding: '1px 6px', borderRadius: '999px',
            background: '#f3f4f6'
          }}>
            {demo.firm_size}
          </span>
        )}
      </div>

      {demo.use_case && (
        <div style={{
          fontSize: '11px', color: '#4b5563', marginTop: '6px',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
        }}>
          {demo.use_case}
        </div>
      )}
    </div>
  )
}

function MobileDemoList({ stages, demosInStage, showCreator = false, onEdit, onDelete, onStageChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {stages.map(stage => {
        const items = demosInStage(stage.key)
        if (items.length === 0) return null
        return (
          <div key={stage.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', padding: '0 4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: stage.color }} />
              <strong style={{ fontSize: '13px', color: '#111827' }}>{stage.label}</strong>
              <span style={{ fontSize: '11px', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map(d => (
                <MobileDemoCard
                  key={d.id}
                  demo={d}
                  stages={stages}
                  showCreator={showCreator}
                  onEdit={() => onEdit(d)}
                  onDelete={() => onDelete(d.id)}
                  onStageChange={(newStage) => onStageChange(d, newStage)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MobileDemoCard({ demo, stages, showCreator = false, onEdit, onDelete, onStageChange }) {
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
        <div>
          {demo.lead ? (
            <Link
              to={`/leads/${demo.lead.id}`}
              onClick={(e) => e.stopPropagation()}
              style={{ color: '#1d4ed8', fontWeight: 600, fontSize: '15px', textDecoration: 'none' }}
            >
              {demo.lead.name}
            </Link>
          ) : (
            <span style={{ color: '#9ca3af', fontWeight: 600, fontSize: '15px' }}>No lead linked</span>
          )}
          {demo.lead?.firm_name && (
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{demo.lead.firm_name}</div>
          )}
          {showCreator && demo.created_by_person?.name && (
            <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px', fontStyle: 'italic' }}>
              by {demo.created_by_person.name}
            </div>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Delete"
          style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '4px' }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {demo.demo_datetime ? (
          <span style={{ fontSize: '12px', color: '#374151', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Calendar size={12} /> {fmtDateTimeIST(demo.demo_datetime)}
          </span>
        ) : demo.demo_date ? (
          <span style={{ fontSize: '12px', color: '#374151', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Calendar size={12} /> {fmtDate(demo.demo_date)}
          </span>
        ) : null}
        {demo.keenness && (
          <span style={{
            fontSize: '11px', fontWeight: 600,
            padding: '2px 8px', borderRadius: '999px',
            background: keennessColor(demo.keenness) + '22',
            color: keennessColor(demo.keenness)
          }}>
            {demo.keenness}/5
          </span>
        )}
        {demo.firm_size && (
          <span style={{ fontSize: '11px', color: '#6b7280', padding: '2px 8px', borderRadius: '999px', background: '#f3f4f6' }}>
            {demo.firm_size}
          </span>
        )}
      </div>
      {demo.use_case && (
        <div style={{
          fontSize: '12px', color: '#4b5563', marginBottom: '10px',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
        }}>
          {demo.use_case}
        </div>
      )}

      <select
        value={demo.stage}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); onStageChange(e.target.value) }}
        style={{ width: '100%', fontSize: '12px', padding: '6px 8px' }}
      >
        {stages.map(s => (
          <option key={s.key} value={s.key}>Move to: {s.label}</option>
        ))}
      </select>
    </div>
  )
}

// Add / edit form. For new demos, includes a "lead picker" that lets you
// pick from existing leads OR paste a LinkedIn URL (which auto-creates the
// lead so the demo can link to it). For existing demos, the lead is fixed.
function DemoForm({ demo, currentPersonId, onClose, onSave }) {
  const { toast } = useToast()
  const isEdit = !!demo

  const [form, setForm] = useState({
    lead_id: demo?.lead_id || demo?.lead?.id || null,
    stage: demo?.stage || 'scheduled',
    demo_date: demo?.demo_date || '',
    demo_datetime_local: toLocalIstInput(demo?.demo_datetime),
    decision_maker: demo?.decision_maker || '',
    team_size: demo?.team_size || '',
    firm_size: demo?.firm_size || '',
    keenness: demo?.keenness ?? '',
    // B2B sales context
    current_tools: Array.isArray(demo?.current_tools) ? demo.current_tools : [],
    decision_timeline: demo?.decision_timeline || '',
    budget_signal: demo?.budget_signal || '',
    integrations_needed: demo?.integrations_needed || '',
    objections: demo?.objections || '',
    calendar_invite_url: demo?.calendar_invite_url || '',
    use_case: demo?.use_case || '',
    feedback: demo?.feedback || '',
    transcript: demo?.transcript || '',
    next_steps: demo?.next_steps || '',
    notes: demo?.notes || ''
  })
  const [saving, setSaving] = useState(false)

  // Lead picker state — only used in create mode.
  const [leads, setLeads] = useState([])
  const [leadSearch, setLeadSearch] = useState('')
  const [pickedLead, setPickedLead] = useState(demo?.lead || null)
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [resolvingUrl, setResolvingUrl] = useState(false)

  useEffect(() => {
    if (isEdit) return
    let alive = true
    getLeads({}, currentPersonId)
      .then(data => { if (alive) setLeads(data) })
      .catch(err => console.error('Failed to load leads:', err))
    return () => { alive = false }
  }, [isEdit, currentPersonId])

  const filteredLeads = useMemo(() => {
    const q = leadSearch.trim().toLowerCase()
    if (!q) return leads.slice(0, 25)
    return leads
      .filter(l => (l.name || '').toLowerCase().includes(q) || (l.firm_name || '').toLowerCase().includes(q))
      .slice(0, 25)
  }, [leads, leadSearch])

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function pickLead(lead) {
    setPickedLead(lead)
    update('lead_id', lead.id)
  }

  async function resolveLinkedInUrl() {
    const url = linkedinUrl.trim()
    if (!url) return
    if (!isLinkedInUrl(url)) {
      toast.warn("That doesn't look like a LinkedIn URL")
      return
    }
    setResolvingUrl(true)
    try {
      let lead = await findLeadByLinkedInUrl(url)
      if (!lead) {
        const guessedName = nameFromLinkedInUrl(url) || 'Unknown'
        lead = await createLead({
          name: guessedName,
          linkedin_url: url,
          stage: 'cold_outreach',
          lead_source: 'LinkedIn'
        }, currentPersonId)
        toast.success(`Created lead "${lead.name}"`)
      }
      pickLead(lead)
      setLinkedinUrl('')
    } catch (err) {
      console.error('Failed to resolve LinkedIn URL:', err)
      toast.error('Failed: ' + err.message)
    } finally {
      setResolvingUrl(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!isEdit && !form.lead_id) {
      toast.warn('Pick a lead first (search existing or paste a LinkedIn URL)')
      return
    }
    setSaving(true)
    try {
      const payload = { ...form }
      // Convert the IST-interpreted datetime-local back to a UTC ISO
      // string for storage. Strip the helper-only field before save.
      payload.demo_datetime = fromLocalIstInput(payload.demo_datetime_local)
      delete payload.demo_datetime_local
      // If a datetime is set, derive demo_date from it so the date column
      // stays consistent and legacy display paths still work.
      if (payload.demo_datetime) {
        payload.demo_date = payload.demo_datetime.slice(0, 10)
      } else if (!payload.demo_date) {
        payload.demo_date = null
      }
      payload.keenness = payload.keenness === '' || payload.keenness == null
        ? null
        : Number(payload.keenness)
      if (!payload.firm_size) payload.firm_size = null
      if (!payload.team_size) payload.team_size = null
      if (!payload.decision_timeline) payload.decision_timeline = null
      if (!payload.budget_signal) payload.budget_signal = null
      if (!payload.integrations_needed) payload.integrations_needed = null
      if (!payload.objections) payload.objections = null
      if (!payload.calendar_invite_url) payload.calendar_invite_url = null
      if (!Array.isArray(payload.current_tools)) payload.current_tools = []
      // lead_id can't change on edit — strip it to avoid sending to update.
      if (isEdit) delete payload.lead_id
      await onSave(payload)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ margin: 0 }}>{isEdit ? 'Edit Demo' : 'Add Demo'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Lead — fixed on edit, picker on create */}
          {isEdit ? (
            <div className="form-group">
              <label>Lead</label>
              <div style={{ padding: '8px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                {demo.lead ? (
                  <Link to={`/leads/${demo.lead.id}`} style={{ fontWeight: 600, color: '#1d4ed8' }}>
                    {demo.lead.name}{demo.lead.firm_name ? ` — ${demo.lead.firm_name}` : ''}
                  </Link>
                ) : <span style={{ color: '#9ca3af' }}>No lead linked</span>}
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label>Lead *</label>
              {pickedLead ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px' }}>
                  <div>
                    <strong>{pickedLead.name}</strong>
                    {pickedLead.firm_name && <span style={{ color: '#6b7280', marginLeft: '8px' }}>{pickedLead.firm_name}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setPickedLead(null); update('lead_id', null) }}
                    style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}
                    title="Change lead"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
                    <Linkedin size={16} style={{ color: '#0a66c2', flexShrink: 0 }} />
                    <input
                      type="url"
                      placeholder="Paste LinkedIn URL to add a new lead…"
                      value={linkedinUrl}
                      onChange={e => setLinkedinUrl(e.target.value)}
                      style={{ flex: 1, fontSize: '13px' }}
                      disabled={resolvingUrl}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={resolveLinkedInUrl}
                      disabled={resolvingUrl || !linkedinUrl.trim()}
                    >
                      {resolvingUrl ? 'Resolving…' : 'Use'}
                    </button>
                  </div>
                  <div style={{ position: 'relative', marginBottom: '6px' }}>
                    <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                    <input
                      type="text"
                      placeholder="…or search existing leads"
                      value={leadSearch}
                      onChange={e => setLeadSearch(e.target.value)}
                      style={{ width: '100%', paddingLeft: '32px', fontSize: '13px' }}
                    />
                  </div>
                  <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                    {filteredLeads.length === 0 ? (
                      <div style={{ padding: '14px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
                        {leads.length === 0 ? 'No leads yet — paste a LinkedIn URL above to add one.' : 'No matches'}
                      </div>
                    ) : (
                      filteredLeads.map(l => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => pickLead(l)}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '8px 12px', background: 'white', border: 'none',
                            borderBottom: '1px solid #f3f4f6', cursor: 'pointer'
                          }}
                        >
                          <div style={{ fontSize: '13px', fontWeight: 500, color: '#111827' }}>{l.name}</div>
                          {l.firm_name && (
                            <div style={{ fontSize: '11px', color: '#6b7280' }}>{l.firm_name}</div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}

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
              <label>Demo Date &amp; Time (IST)</label>
              <input
                type="datetime-local"
                value={form.demo_datetime_local}
                onChange={e => update('demo_datetime_local', e.target.value)}
              />
              <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                Times are stored and shown in IST. Leave blank if you only know the date.
              </div>
            </div>
          </div>

          {!form.demo_datetime_local && (
            <div className="form-group">
              <label>Demo Date (date only)</label>
              <input type="date" value={form.demo_date} onChange={e => update('demo_date', e.target.value)} />
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label>Firm Size (AUM)</label>
              <select value={form.firm_size} onChange={e => update('firm_size', e.target.value)}>
                <option value="">—</option>
                {FIRM_SIZE_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Team Size</label>
              <select value={form.team_size} onChange={e => update('team_size', e.target.value)}>
                <option value="">—</option>
                {TEAM_SIZE_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Keenness</label>
              <select
                value={form.keenness}
                onChange={e => update('keenness', e.target.value)}
              >
                <option value="">—</option>
                {KEENNESS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.value} — {opt.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Decision Maker</label>
              <input
                type="text"
                value={form.decision_maker}
                onChange={e => update('decision_maker', e.target.value)}
                placeholder="Who actually decides on tooling"
              />
            </div>
          </div>

          {/* B2B sales context — what they're using, how soon, how much,
              what would need to integrate, and reasons they couldn't sign. */}
          <div className="form-group">
            <label>Current Tools</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {CURRENT_TOOLS_OPTIONS.map(tool => {
                const selected = (form.current_tools || []).includes(tool)
                return (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => {
                      const cur = form.current_tools || []
                      update('current_tools', selected ? cur.filter(t => t !== tool) : [...cur, tool])
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '999px',
                      border: selected ? '1.5px solid #2563eb' : '1px solid #e5e7eb',
                      background: selected ? '#eff6ff' : 'white',
                      color: selected ? '#1d4ed8' : '#374151',
                      fontSize: '12px',
                      fontWeight: selected ? 600 : 500,
                      cursor: 'pointer'
                    }}
                  >
                    {tool}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '6px' }}>
              Pick everything they mentioned — multi-select.
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Decision Timeline</label>
              <select value={form.decision_timeline} onChange={e => update('decision_timeline', e.target.value)}>
                <option value="">—</option>
                {DECISION_TIMELINE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Budget Signal</label>
              <select value={form.budget_signal} onChange={e => update('budget_signal', e.target.value)}>
                <option value="">—</option>
                {BUDGET_SIGNAL_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Integrations Needed</label>
            <textarea
              value={form.integrations_needed}
              onChange={e => update('integrations_needed', e.target.value)}
              placeholder="What systems do they need PE OS to talk to? (CRM, data providers, accounting, etc.)"
              rows={2}
            />
          </div>

          <div className="form-group">
            <label>Calendar Invite Link</label>
            <input
              type="url"
              value={form.calendar_invite_url}
              onChange={e => update('calendar_invite_url', e.target.value)}
              placeholder="https://calendar.google.com/event?..."
            />
          </div>

          <div className="form-group">
            <label>Use Case</label>
            <textarea
              value={form.use_case}
              onChange={e => update('use_case', e.target.value)}
              placeholder="How they'd use PE OS — workflow, pain points, what would replace…"
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Feedback from Call</label>
            <textarea
              value={form.feedback}
              onChange={e => update('feedback', e.target.value)}
              placeholder="What they liked, what resonated, general reaction…"
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Objections</label>
            <textarea
              value={form.objections}
              onChange={e => update('objections', e.target.value)}
              placeholder="Specific reasons they couldn't sign — pricing, integrations, internal politics, etc. Keeps deal blockers separate from general feedback."
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Next Steps</label>
            <textarea
              value={form.next_steps}
              onChange={e => update('next_steps', e.target.value)}
              placeholder="Follow-up actions, who's doing what by when"
              rows={2}
            />
          </div>

          <div className="form-group">
            <label>Transcript</label>
            <textarea
              value={form.transcript}
              onChange={e => update('transcript', e.target.value)}
              placeholder="Paste full transcript or a link to one"
              rows={5}
              style={{ fontFamily: 'monospace', fontSize: '12px' }}
            />
          </div>

          <div className="form-group">
            <label>Other Notes</label>
            <textarea
              value={form.notes}
              onChange={e => update('notes', e.target.value)}
              rows={2}
            />
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || (!isEdit && !form.lead_id)}
            >
              {saving ? 'Saving…' : isEdit ? 'Update' : 'Add Demo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ViewPill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        borderRadius: '999px',
        border: active ? '1.5px solid #2563eb' : '1px solid #e5e7eb',
        background: active ? '#eff6ff' : 'white',
        color: active ? '#1d4ed8' : '#111827',
        fontSize: '13px',
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        transition: 'border-color 0.12s, background 0.12s'
      }}
    >
      {children}
    </button>
  )
}

export default PEOSBoard
