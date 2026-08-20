import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../App'
import {
  getFollowUpBoard,
  logFollowUpTouch,
  snoozeFollowUp,
  clearFollowUp
} from '../lib/crm-api'
import { istToday, fmtDate } from '../lib/dateUtils'
import { useToast } from '../components/Toast'
import { isAdminUser } from '../lib/admin'
import { notifyFollowUpsChanged } from '../hooks/useFollowUpCount'
import StageChip from '../components/StageChip'
import { Bell, Check, X, ExternalLink, Repeat, AlarmClock, CalendarClock, RefreshCw } from 'lucide-react'

/**
 * Notifications — every scheduled reach-out in one place, bucketed by
 * urgency: overdue, due today, and what's coming over the next fortnight.
 *
 * Deliberately narrower than Today: Today ranks ALL of a person's work
 * (queue, cadence marks, escalations) and is the "what do I do now" page.
 * This one only ever shows leads with an explicitly scheduled follow-up
 * date, and it looks forward — it's the "what did I promise, and when"
 * page. Both read the same next_follow_up_date column.
 */
function Notifications() {
  const { currentPerson, people } = useApp()
  const { toast } = useToast()
  const isAdmin = isAdminUser(currentPerson)

  const [board, setBoard] = useState({ overdue: [], dueToday: [], upcoming: [], upcomingDays: 14 })
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState(null)
  const [showAllOwners, setShowAllOwners] = useState(false)

  const personById = useMemo(() => {
    const m = new Map()
    for (const p of people || []) m.set(p.id, p)
    return m
  }, [people])

  // silent: refresh in place after a row action without flashing the
  // full-page spinner.
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!currentPerson?.id) return
    if (!silent) setLoading(true)
    try {
      setBoard(await getFollowUpBoard(showAllOwners && isAdmin ? null : currentPerson.id))
    } catch (err) {
      console.error('Failed to load notifications:', err)
      toast.error('Failed to load follow-ups')
    } finally {
      setLoading(false)
    }
  }, [currentPerson?.id, isAdmin, showAllOwners]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  async function act(lead, label, fn) {
    setPendingId(lead.id)
    try {
      await fn()
      notifyFollowUpsChanged()
      toast.success(label)
      // Reload rather than optimistically dropping the row: a snoozed lead
      // genuinely belongs in "Coming up", and stripping it made the page
      // claim "Nothing scheduled" for something scheduled tomorrow.
      await load({ silent: true })
    } catch (err) {
      console.error(`${label} failed:`, err)
      toast.error(`Failed: ${err.message}`)
    } finally {
      setPendingId(null)
    }
  }

  const handleTouch = lead => act(lead, `Logged reach-out on ${lead.name}`, () =>
    logFollowUpTouch(lead, currentPerson.id))
  const handleSnooze = (lead, days) => act(lead, `${lead.name} pushed ${days} day${days === 1 ? '' : 's'}`, () =>
    snoozeFollowUp(lead, days, { note: lead.follow_up_note }, currentPerson.id))
  const handleClear = lead => act(lead, `Reminder cleared on ${lead.name}`, () =>
    clearFollowUp(lead.id, currentPerson.id))

  const total = board.overdue.length + board.dueToday.length + board.upcoming.length

  if (loading) {
    return (
      <div className="page-container">
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 12px' }}></div>
          Loading follow-ups…
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
            <Bell size={24} /> Notifications
          </h1>
          <p style={{ color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
            Every reach-out you've scheduled — what's late, what's today, and what's coming.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isAdmin && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#374151' }}>
              <input
                type="checkbox"
                checked={showAllOwners}
                onChange={e => setShowAllOwners(e.target.checked)}
              />
              All owners
            </label>
          )}
          <button className="btn btn-sm btn-secondary" onClick={() => load()}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className={`stat-card ${board.overdue.length > 0 ? 'danger' : ''}`}>
          <div className="stat-value">{board.overdue.length}</div>
          <div className="stat-label">Overdue</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{board.dueToday.length}</div>
          <div className="stat-label">Due today</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{board.upcoming.length}</div>
          <div className="stat-label">Next {board.upcomingDays} days</div>
        </div>
      </div>

      {total === 0 && (
        <div className="card" style={{ padding: '36px', textAlign: 'center', color: '#6b7280' }}>
          <Bell size={32} style={{ color: '#9ca3af', marginBottom: '8px' }} />
          <div style={{ fontSize: '14px', marginBottom: '4px' }}>Nothing scheduled.</div>
          <div style={{ fontSize: '13px' }}>
            Open a lead and use <strong>Reach back out</strong> to schedule one, or put it on a cadence.
          </div>
        </div>
      )}

      <Section
        icon={<AlarmClock size={16} />}
        title="Overdue"
        subtitle="Promised earlier, still not done"
        tone="danger"
        leads={board.overdue}
        {...{ personById, isAdmin: isAdmin && showAllOwners, pendingId, handleTouch, handleSnooze, handleClear }}
      />
      <Section
        icon={<Bell size={16} />}
        title="Due today"
        leads={board.dueToday}
        {...{ personById, isAdmin: isAdmin && showAllOwners, pendingId, handleTouch, handleSnooze, handleClear }}
      />
      <Section
        icon={<CalendarClock size={16} />}
        title={`Coming up — next ${board.upcomingDays} days`}
        subtitle="Nothing to do yet; here so nothing sneaks up on you"
        leads={board.upcoming}
        {...{ personById, isAdmin: isAdmin && showAllOwners, pendingId, handleTouch, handleSnooze, handleClear }}
      />
    </div>
  )
}

function Section({ icon, title, subtitle, tone, leads, personById, isAdmin, pendingId, handleTouch, handleSnooze, handleClear }) {
  if (!leads.length) return null
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '16px' }}>
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid #e5e7eb',
        background: tone === 'danger' ? '#fef2f2' : '#f9fafb'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '15px',
          color: tone === 'danger' ? '#991b1b' : '#111827'
        }}>
          {icon} {title} <span style={{ fontWeight: 500, color: '#6b7280' }}>({leads.length})</span>
        </div>
        {subtitle && <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{subtitle}</div>}
      </div>
      <div style={{ padding: '10px' }}>
        {leads.map(lead => (
          <Row
            key={lead.id}
            lead={lead}
            ownerName={isAdmin ? (personById.get(lead.assigned_to)?.name || 'Unassigned') : null}
            busy={pendingId === lead.id}
            onTouch={handleTouch}
            onSnooze={handleSnooze}
            onClear={handleClear}
          />
        ))}
      </div>
    </div>
  )
}

function Row({ lead, ownerName, busy, onTouch, onSnooze, onClear }) {
  const today = istToday()
  const overdue = lead.next_follow_up_date < today
  const cadence = lead.follow_up_cadence

  return (
    <div style={{ borderBottom: '1px solid #f3f4f6', padding: '12px 10px', opacity: busy ? 0.5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '240px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 500, color: '#111827', fontSize: '14px' }}>{lead.name || 'Unknown'}</span>
            {lead.firm_name && <span style={{ color: '#6b7280', fontSize: '13px' }}>— {lead.firm_name}</span>}
            <StageChip stage={lead.stage} />
            <span style={{
              fontSize: '12px', fontWeight: 600,
              color: overdue ? '#b91c1c' : lead.next_follow_up_date === today ? '#0c4a6e' : '#6b7280'
            }}>
              {overdue ? `overdue since ${fmtDate(lead.next_follow_up_date)}` :
                lead.next_follow_up_date === today ? 'due today' : fmtDate(lead.next_follow_up_date)}
            </span>
            {ownerName && <span style={{ fontSize: '12px', color: '#6b7280' }}>owner: {ownerName}</span>}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
            {lead.follow_up_note ? `“${lead.follow_up_note}”` : 'No note on this one'}
            {cadence?.offsets?.length > 0 && (
              <span style={{ marginLeft: '8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Repeat size={11} /> {cadence.name} {Math.min(cadence.step, cadence.offsets.length)}/{cadence.offsets.length}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button className="btn btn-sm btn-primary" onClick={() => onTouch(lead)} disabled={busy}
            title="Log the reach-out — a cadence rolls to its next day automatically">
            <Check size={14} /> Reached out
          </button>
          {[[1, '+1d'], [7, '+1w']].map(([days, label]) => (
            <button key={days} className="btn btn-sm btn-secondary" onClick={() => onSnooze(lead, days)} disabled={busy}>
              {label}
            </button>
          ))}
          <Link to={`/leads/${lead.id}`} className="btn btn-sm btn-secondary">Open</Link>
          {lead.linkedin_url && (
            <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer"
              className="btn btn-sm btn-secondary" title="Open LinkedIn profile">
              <ExternalLink size={14} />
            </a>
          )}
          <button className="btn btn-sm btn-secondary" onClick={() => onClear(lead)} disabled={busy}
            title="Drop the reminder entirely" style={{ color: '#b91c1c' }}>
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default Notifications
