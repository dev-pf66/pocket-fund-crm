import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../App'
import {
  getNotificationFeed,
  logFollowUpTouch,
  snoozeFollowUp,
  clearFollowUp,
  assignLead
} from '../lib/crm-api'
import { useToast } from '../components/Toast'
import { isAdminUser } from '../lib/admin'
import { notifyFollowUpsChanged } from '../hooks/useNotificationCount'
import StageChip from '../components/StageChip'
import {
  Bell, Check, X, ExternalLink, Repeat, AlarmClock, CalendarClock,
  RefreshCw, PhoneCall, Presentation, UserPlus, EyeOff, Store, Handshake, AlertTriangle
} from 'lucide-react'

/**
 * Notifications — everything that wants your attention, ranked.
 *
 * Deliberately narrower than Today: Today ranks a person's whole book and is
 * the "what do I do now" page. This one answers "what have I promised, what
 * has slipped, and what is about to". The difference from the old version is
 * where the answer comes from — it used to be one hand-entered date column,
 * which meant it was usually empty while the pipeline quietly went cold. The
 * feed is now derived (see lib/api/notifications.js); a scheduled date is one
 * signal among several.
 */

const KIND_META = {
  callback: { label: 'Callback', icon: PhoneCall, tone: '#0ea5e9' },
  demo: { label: 'Demo', icon: Presentation, tone: '#7c3aed' },
  followup: { label: 'Follow-up', icon: AlarmClock, tone: '#0c4a6e' },
  seller_followup: { label: 'Seller', icon: Store, tone: '#b45309' },
  partner_followup: { label: 'Partner', icon: Handshake, tone: '#0f766e' },
  went_quiet: { label: 'Gone quiet', icon: EyeOff, tone: '#b91c1c' },
  unowned: { label: 'No owner', icon: UserPlus, tone: '#9333ea' }
}

const BUCKETS = [
  { key: 'overdue', title: 'Slipped', subtitle: 'Promised or expected earlier, still not done', tone: 'danger' },
  { key: 'today', title: 'Needs you today', subtitle: null, tone: null },
  { key: 'soon', title: 'Next three days', subtitle: null, tone: null },
  { key: 'upcoming', title: 'Coming up', subtitle: 'Nothing to do yet — here so nothing sneaks up on you', tone: null }
]

function Notifications() {
  const { currentPerson, people } = useApp()
  const { toast } = useToast()
  const isAdmin = isAdminUser(currentPerson)

  const [feed, setFeed] = useState({ items: [], counts: null, errors: [], truncated: false })
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState(null)
  const [showAllOwners, setShowAllOwners] = useState(false)
  const [kindFilter, setKindFilter] = useState(null)

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
      setFeed(await getNotificationFeed(
        showAllOwners && isAdmin ? null : currentPerson.id,
        { isAdmin }
      ))
    } catch (err) {
      console.error('Failed to load notifications:', err)
      toast.error('Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [currentPerson?.id, isAdmin, showAllOwners]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  async function act(item, label, fn) {
    setPendingId(item.id)
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

  const handleTouch = item => act(item, `Logged reach-out on ${item.title}`, () =>
    logFollowUpTouch(item.lead, currentPerson.id))
  const handleSnooze = (item, days) => act(item, `${item.title} pushed ${days} day${days === 1 ? '' : 's'}`, () =>
    snoozeFollowUp(item.lead, days, { note: item.lead?.follow_up_note }, currentPerson.id))
  const handleClear = item => act(item, `Reminder cleared on ${item.title}`, () =>
    clearFollowUp(item.leadId, currentPerson.id))
  const handleClaim = item => act(item, `${item.title} assigned to you`, () =>
    assignLead(item.leadId, currentPerson.id, currentPerson.id))

  const visible = kindFilter ? feed.items.filter(i => i.kind === kindFilter) : feed.items
  const counts = feed.counts

  if (loading) {
    return (
      <div className="page-container">
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 12px' }}></div>
          Working out what needs you…
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
            Promised callbacks, scheduled reach-outs, demos on the calendar, and conversations that have gone quiet.
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

      {/* A source that failed must say so. A notification page that silently
          under-reports is worse than one that is plainly down. */}
      {feed.errors?.length > 0 && (
        <div className="card" style={{ padding: '12px 14px', marginBottom: '16px', background: '#fffbeb', border: '1px solid #fde68a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#92400e', fontSize: '13px', fontWeight: 600 }}>
            <AlertTriangle size={15} /> Showing an incomplete list
          </div>
          <div style={{ fontSize: '12px', color: '#92400e', marginTop: '4px' }}>
            {feed.errors.map(e => `${e.source}: ${e.message}`).join(' · ')}
          </div>
        </div>
      )}

      <div className="stats-grid">
        <div className={`stat-card ${counts?.overdue > 0 ? 'danger' : ''}`}>
          <div className="stat-value">{counts?.overdue ?? 0}</div>
          <div className="stat-label">Slipped</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{counts?.today ?? 0}</div>
          <div className="stat-label">Today</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{counts?.soon ?? 0}</div>
          <div className="stat-label">Next 3 days</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{counts?.upcoming ?? 0}</div>
          <div className="stat-label">Later this fortnight</div>
        </div>
      </div>

      {/* Filter pills double as the legend: what kinds exist, and how many. */}
      {counts && Object.keys(counts.byKind || {}).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '4px 0 16px' }}>
          <button
            className={`btn btn-sm ${kindFilter === null ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setKindFilter(null)}
          >
            Everything ({counts.total})
          </button>
          {Object.entries(counts.byKind)
            .sort((a, b) => b[1] - a[1])
            .map(([kind, n]) => {
              const meta = KIND_META[kind] || { label: kind, icon: Bell }
              const Icon = meta.icon
              return (
                <button
                  key={kind}
                  className={`btn btn-sm ${kindFilter === kind ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setKindFilter(kindFilter === kind ? null : kind)}
                >
                  <Icon size={13} /> {meta.label} ({n})
                </button>
              )
            })}
        </div>
      )}

      {visible.length === 0 && (
        <div className="card" style={{ padding: '36px', textAlign: 'center', color: '#6b7280' }}>
          <Bell size={32} style={{ color: '#9ca3af', marginBottom: '8px' }} />
          <div style={{ fontSize: '14px', marginBottom: '4px' }}>Nothing is waiting on you.</div>
          <div style={{ fontSize: '13px' }}>
            Every promised callback is made, nothing has gone quiet past its threshold, and nothing is due.
          </div>
        </div>
      )}

      {BUCKETS.map(bucket => (
        <Section
          key={bucket.key}
          {...bucket}
          items={visible.filter(i => i.urgency === bucket.key)}
          personById={personById}
          showOwner={isAdmin && showAllOwners}
          pendingId={pendingId}
          handlers={{ handleTouch, handleSnooze, handleClear, handleClaim }}
        />
      ))}

      {feed.truncated && (
        <div style={{ textAlign: 'center', fontSize: '12px', color: '#6b7280', padding: '8px' }}>
          Showing the top {feed.items.length}. Work these down, or archive what is never coming back
          (Admin → Archive old leads).
        </div>
      )}
    </div>
  )
}

function Section({ title, subtitle, tone, items, personById, showOwner, pendingId, handlers }) {
  if (!items.length) return null
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
          {tone === 'danger' ? <AlarmClock size={16} /> : <CalendarClock size={16} />}
          {title} <span style={{ fontWeight: 500, color: '#6b7280' }}>({items.length})</span>
        </div>
        {subtitle && <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{subtitle}</div>}
      </div>
      <div style={{ padding: '10px' }}>
        {items.map(item => (
          <Row
            key={item.id}
            item={item}
            ownerName={showOwner ? (personById.get(item.ownerId)?.name || 'Unassigned') : null}
            busy={pendingId === item.id}
            handlers={handlers}
          />
        ))}
      </div>
    </div>
  )
}

function Row({ item, ownerName, busy, handlers }) {
  const meta = KIND_META[item.kind] || { label: item.kind, icon: Bell, tone: '#6b7280' }
  const Icon = meta.icon
  const cadence = item.lead?.follow_up_cadence

  return (
    <div style={{ borderBottom: '1px solid #f3f4f6', padding: '12px 10px', opacity: busy ? 0.5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '240px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px',
              fontWeight: 600, color: meta.tone, border: `1px solid ${meta.tone}33`,
              background: `${meta.tone}11`, borderRadius: '4px', padding: '1px 6px'
            }}>
              <Icon size={11} /> {meta.label}
            </span>
            <span style={{ fontWeight: 500, color: '#111827', fontSize: '14px' }}>{item.title}</span>
            {item.subtitle && <span style={{ color: '#6b7280', fontSize: '13px' }}>— {item.subtitle}</span>}
            {item.stage && <StageChip stage={item.stage} />}
            <span style={{
              fontSize: '12px', fontWeight: 600,
              color: item.urgency === 'overdue' ? '#b91c1c' : item.urgency === 'today' ? '#0c4a6e' : '#6b7280'
            }}>
              {item.timing}
            </span>
            {ownerName && <span style={{ fontSize: '12px', color: '#6b7280' }}>owner: {ownerName}</span>}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
            {item.detail || 'No note on this one'}
            {item.meta && <span style={{ marginLeft: '8px' }}>{item.meta}</span>}
            {cadence?.offsets?.length > 0 && (
              <span style={{ marginLeft: '8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Repeat size={11} /> {cadence.name} {Math.min(cadence.step, cadence.offsets.length)}/{cadence.offsets.length}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Only a lead-backed reminder can be "reached out" and rolled
              forward. A demo or a seller row has no cadence to advance, so
              offering the button would be a lie. */}
          {item.actionable && item.lead && (
            <>
              <button className="btn btn-sm btn-primary" onClick={() => handlers.handleTouch(item)} disabled={busy}
                title="Log the reach-out — a cadence rolls to its next day automatically">
                <Check size={14} /> Reached out
              </button>
              {[[1, '+1d'], [7, '+1w']].map(([days, label]) => (
                <button key={days} className="btn btn-sm btn-secondary" onClick={() => handlers.handleSnooze(item, days)} disabled={busy}>
                  {label}
                </button>
              ))}
            </>
          )}
          {item.kind === 'unowned' && (
            <button className="btn btn-sm btn-primary" onClick={() => handlers.handleClaim(item)} disabled={busy}>
              <UserPlus size={14} /> Claim
            </button>
          )}
          <Link to={item.href} className="btn btn-sm btn-secondary">Open</Link>
          {item.linkedinUrl && (
            <a href={item.linkedinUrl} target="_blank" rel="noopener noreferrer"
              className="btn btn-sm btn-secondary" title="Open LinkedIn profile">
              <ExternalLink size={14} />
            </a>
          )}
          {item.kind === 'followup' && (
            <button className="btn btn-sm btn-secondary" onClick={() => handlers.handleClear(item)} disabled={busy}
              title="Drop the reminder entirely" style={{ color: '#b91c1c' }}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default Notifications
