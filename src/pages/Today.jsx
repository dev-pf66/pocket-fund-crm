import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../App'
import {
  getTodayQueue,
  getFollowUpsDue,
  getEscalations,
  getTodayCounters,
  getTodayThresholds,
  getUnassignedLeads,
  getMovementWeekOverWeek,
  getTeamMovementThisWeek,
  bulkClaimLeads,
  bulkMarkTouched,
  bulkSnoozeLeads,
  bulkDismissLeads,
  markLeadTouched,
  pingDevOnLead,
  updateLead,
  daysStaleFor
} from '../lib/crm-api'
import { istToday, istAddDays, fmtDate } from '../lib/dateUtils'
import { useToast } from '../components/Toast'
import { notifyFollowUpsChanged } from '../hooks/useFollowUpCount'
import { isAdminUser } from '../lib/admin'
import StageChip from '../components/StageChip'
import StalenessBadge from '../components/StalenessBadge'
import {
  Sun,
  Check,
  ExternalLink,
  AlarmClock,
  Megaphone,
  ChevronDown,
  Inbox,
  RefreshCw,
  XCircle,
  Square,
  CheckSquare
} from 'lucide-react'

// The pipeline owner sees the unassigned banner alongside admins. Matched
// by name — the CRM has no explicit "pipeline owner" flag.
function isPipelineOwner(person) {
  return /\baum\b/i.test(person?.name || '')
}

function Today() {
  const { currentPerson, people } = useApp()
  const { toast } = useToast()
  const isAdmin = isAdminUser(currentPerson)
  const showUnassigned = isAdmin || isPipelineOwner(currentPerson)

  const [loading, setLoading] = useState(true)
  const [queue, setQueue] = useState({ leads: [], total: 0 })
  const [followUps, setFollowUps] = useState([])
  const [escalations, setEscalations] = useState([])
  const [counters, setCounters] = useState({ overdueSLA: 0, touchesThisWeek: 0, touchesLastWeek: 0 })
  const [settings, setSettings] = useState(null)
  const [unassigned, setUnassigned] = useState([])
  const [rollup, setRollup] = useState([])
  const [movement, setMovement] = useState({ advanced: 0, replies: 0, meetings: 0, live: 0 })
  const [prevMovement, setPrevMovement] = useState(null)
  const [pendingId, setPendingId] = useState(null)
  const [pingedIds, setPingedIds] = useState(() => new Set())
  const [claiming, setClaiming] = useState(false)
  const [pullingMore, setPullingMore] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showBulkSnooze, setShowBulkSnooze] = useState(false)

  const personById = useMemo(() => {
    const map = new Map()
    for (const p of people || []) map.set(p.id, p)
    return map
  }, [people])

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [queueRes, fuRes, escRes, ctrRes, thresholds, moveRes] = await Promise.all([
        getTodayQueue(currentPerson.id),
        getFollowUpsDue(currentPerson.id),
        // Dev/admin sees escalations across every owner's book.
        getEscalations(isAdmin ? null : currentPerson.id),
        getTodayCounters(currentPerson.id),
        getTodayThresholds(),
        // Outcome metrics — what moved, vs last week.
        getMovementWeekOverWeek(currentPerson.id).catch(err => {
          console.error('Movement stats failed:', err)
          return null
        })
      ])
      setQueue(queueRes)
      setFollowUps(fuRes)
      setEscalations(escRes)
      setCounters(ctrRes)
      setSettings(thresholds.raw)
      if (moveRes) {
        setMovement(moveRes.current)
        setPrevMovement(moveRes.previous)
      }

      if (showUnassigned) {
        getUnassignedLeads().then(setUnassigned).catch(err => console.error('Unassigned load failed:', err))
      }
      if (isAdmin) {
        getTeamMovementThisWeek().then(setRollup).catch(err => console.error('Rollup load failed:', err))
      }
    } catch (err) {
      console.error('Failed to load Today tab:', err)
      toast.error('Failed to load your day')
    } finally {
      setLoading(false)
    }
  }, [currentPerson?.id, isAdmin, showUnassigned]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentPerson?.id) loadAll()
  }, [currentPerson?.id, loadAll])

  // A lead due for follow-up renders once, in Follow-ups — not again in Touches.
  const followUpIds = useMemo(() => new Set(followUps.map(l => l.id)), [followUps])
  const touchLeads = useMemo(
    () => queue.leads.filter(l => !followUpIds.has(l.id)),
    [queue.leads, followUpIds]
  )

  // Bulk selection spans both Touches and Follow-ups — same row actions,
  // one action bar. Escalations aren't selectable (Ping Dev is idempotent
  // per-lead already and doesn't benefit from batching).
  const selectableLeads = useMemo(() => [...touchLeads, ...followUps], [touchLeads, followUps])
  const selectableById = useMemo(() => new Map(selectableLeads.map(l => [l.id, l])), [selectableLeads])
  const selectedLeads = useMemo(
    () => [...selectedIds].map(id => selectableById.get(id)).filter(Boolean),
    [selectedIds, selectableById]
  )

  // Drop any selected id that's fallen out of the selectable pool (touched,
  // snoozed, dismissed, or reloaded away) so the count never lies.
  useEffect(() => {
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => selectableById.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [selectableById])

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll(ids) {
    setSelectedIds(prev => {
      const allSelected = ids.length > 0 && ids.every(id => prev.has(id))
      const next = new Set(prev)
      if (allSelected) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function removeFromQueues(ids) {
    const idSet = new Set(ids)
    setQueue(prev => ({
      leads: prev.leads.filter(l => !idSet.has(l.id)),
      total: Math.max(0, prev.total - ids.filter(id => !followUpIds.has(id)).length)
    }))
    setFollowUps(prev => prev.filter(l => !idSet.has(l.id)))
  }

  async function handleBulkTouch() {
    if (!selectedLeads.length) return
    setBulkBusy(true)
    try {
      const { succeeded, failed } = await bulkMarkTouched(selectedLeads, currentPerson.id)
      removeFromQueues(succeeded)
      notifyFollowUpsChanged()
      setCounters(prev => ({ ...prev, touchesThisWeek: prev.touchesThisWeek + succeeded.length }))
      clearSelection()
      if (succeeded.length) toast.success(`Logged touch on ${succeeded.length} lead${succeeded.length === 1 ? '' : 's'}`)
      if (failed.length) toast.error(`${failed.length} failed to log`)
    } catch (err) {
      console.error('Bulk touch failed:', err)
      toast.error('Bulk touch failed: ' + err.message)
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleBulkSnooze(days) {
    if (!selectedLeads.length) return
    setShowBulkSnooze(false)
    setBulkBusy(true)
    try {
      const { succeeded, failed } = await bulkSnoozeLeads(selectedLeads, days, currentPerson.id)
      removeFromQueues(succeeded)
      notifyFollowUpsChanged()
      clearSelection()
      if (succeeded.length) toast.success(`Snoozed ${succeeded.length} lead${succeeded.length === 1 ? '' : 's'}`)
      if (failed.length) toast.error(`${failed.length} failed to snooze`)
    } catch (err) {
      console.error('Bulk snooze failed:', err)
      toast.error('Bulk snooze failed: ' + err.message)
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleBulkDismiss() {
    if (!selectedLeads.length) return
    if (!window.confirm(`Mark ${selectedLeads.length} lead${selectedLeads.length === 1 ? '' : 's'} as dead (stage → Passed)? They leave your queue.`)) return
    setBulkBusy(true)
    try {
      const { succeeded, failed } = await bulkDismissLeads(selectedLeads, currentPerson.id)
      removeFromQueues(succeeded)
      notifyFollowUpsChanged()
      clearSelection()
      if (succeeded.length) toast.success(`Marked ${succeeded.length} lead${succeeded.length === 1 ? '' : 's'} dead`)
      if (failed.length) toast.error(`${failed.length} failed to update`)
    } catch (err) {
      console.error('Bulk dismiss failed:', err)
      toast.error('Bulk dismiss failed: ' + err.message)
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleTouched(lead, note) {
    setPendingId(lead.id)
    try {
      await markLeadTouched(lead, currentPerson.id, note)
      notifyFollowUpsChanged()
      setQueue(prev => ({
        leads: prev.leads.filter(l => l.id !== lead.id),
        total: Math.max(0, prev.total - 1)
      }))
      setFollowUps(prev => prev.filter(l => l.id !== lead.id))
      setCounters(prev => ({ ...prev, touchesThisWeek: prev.touchesThisWeek + 1 }))
      toast.success(`Logged touch on ${lead.name}`)
    } catch (err) {
      console.error('Failed to log touch:', err)
      toast.error('Failed: ' + err.message)
    } finally {
      setPendingId(null)
    }
  }

  async function handleSnooze(lead, days) {
    setPendingId(lead.id)
    try {
      const until = istAddDays(istToday(), days)
      await updateLead(lead.id, { next_follow_up_date: until }, currentPerson.id)
      notifyFollowUpsChanged()
      setQueue(prev => ({
        leads: prev.leads.filter(l => l.id !== lead.id),
        total: Math.max(0, prev.total - 1)
      }))
      setFollowUps(prev => prev.filter(l => l.id !== lead.id))
      toast.success(`Snoozed ${lead.name} until ${fmtDate(until)}`)
    } catch (err) {
      console.error('Failed to snooze:', err)
      toast.error('Failed: ' + err.message)
    } finally {
      setPendingId(null)
    }
  }

  async function handleDismiss(lead) {
    setPendingId(lead.id)
    try {
      await updateLead(lead.id, { stage: 'passed' }, currentPerson.id)
      setQueue(prev => ({
        leads: prev.leads.filter(l => l.id !== lead.id),
        total: Math.max(0, prev.total - 1)
      }))
      setFollowUps(prev => prev.filter(l => l.id !== lead.id))
      toast.success(`Marked ${lead.name} dead (Passed)`)
    } catch (err) {
      console.error('Failed to dismiss lead:', err)
      toast.error('Failed: ' + err.message)
    } finally {
      setPendingId(null)
    }
  }

  async function handlePingDev(lead) {
    setPendingId(lead.id)
    try {
      await pingDevOnLead(lead, currentPerson.id, currentPerson.name)
      setPingedIds(prev => new Set(prev).add(lead.id))
      toast.success(`Pinged Dev about ${lead.name}`)
    } catch (err) {
      console.error('Failed to ping Dev:', err)
      toast.error('Failed: ' + err.message)
    } finally {
      setPendingId(null)
    }
  }

  async function handleClaimAll() {
    setClaiming(true)
    try {
      const claimed = await bulkClaimLeads(unassigned.map(l => l.id), currentPerson.id)
      toast.success(`Claimed ${claimed} lead${claimed === 1 ? '' : 's'}`)
      setUnassigned([])
      await loadAll()
    } catch (err) {
      console.error('Bulk claim failed:', err)
      toast.error('Failed to claim leads: ' + err.message)
    } finally {
      setClaiming(false)
    }
  }

  async function handlePullMore() {
    setPullingMore(true)
    try {
      const next = await getTodayQueue(currentPerson.id)
      setQueue(next)
      if (next.total === 0) toast.info('Nothing left to touch today')
    } catch (err) {
      console.error('Failed to pull more:', err)
      toast.error('Failed: ' + err.message)
    } finally {
      setPullingMore(false)
    }
  }

  // null = no prior week recorded yet. Stage history only starts at migration
  // 040, so week one must not imply a flat comparison against zero.
  const movementDelta = prevMovement && movement.sampleFrom && movement.sampleFrom < movement.from
    ? movement.advanced - prevMovement.advanced
    : null

  if (loading) {
    return (
      <div className="page-container">
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 12px' }}></div>
          Loading your day…
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
          <Sun size={24} /> Today
        </h1>
        <p style={{ color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
          Your queue for {fmtDate(istToday())} — work top to bottom, every button logs itself.
        </p>
      </div>

      {/* Header counters */}
      {/* Outcomes lead. The queue size and touch count still matter — they're
          just not the score any more (Dev, Aug 2026). */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{movement.advanced}</div>
          <div className="stat-label">Moved forward this wk</div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
            {movementDelta === null ? 'first week of tracking'
              : <>vs last wk <span style={{ color: movementDelta >= 0 ? '#16a34a' : '#dc2626' }}>
                  {movementDelta >= 0 ? '+' : ''}{movementDelta}
                </span></>}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{movement.replies}</div>
          <div className="stat-label">Replies this wk</div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
            {movement.meetings} meeting{movement.meetings === 1 ? '' : 's'} booked
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{movement.live}</div>
          <div className="stat-label">Live conversations</div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
            {followUps.length} follow-up{followUps.length === 1 ? '' : 's'} due
          </div>
        </div>
        <div className={`stat-card ${escalations.length > 0 ? 'warning' : ''}`}>
          <div className="stat-value">{escalations.length}</div>
          <div className="stat-label">Escalations</div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
            {queue.total} to touch · {counters.overdueSLA} overdue
          </div>
        </div>
      </div>

      {/* Admin: per-person touches this week */}
      {isAdmin && rollup.length > 0 && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
            What moved this week — team
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {rollup.map(r => (
              <span
                key={r.personId}
                style={{
                  padding: '4px 10px', borderRadius: '999px', background: '#f3f4f6',
                  fontSize: '13px', color: '#374151'
                }}
              >
                {r.name} · <strong>{r.advanced}</strong> moved
                {r.meetings ? ` · ${r.meetings} mtg` : ''}
                {r.replies ? ` · ${r.replies} replies` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Unassigned banner (admins + pipeline owner) */}
      {showUnassigned && unassigned.length > 0 && (
        <div
          className="card"
          style={{
            padding: '12px 16px', marginBottom: '16px', display: 'flex',
            alignItems: 'center', justifyContent: 'space-between', gap: '12px',
            background: '#fffbeb', border: '1px solid #fde68a'
          }}
        >
          <span style={{ fontSize: '14px', color: '#92400e' }}>
            <strong>{unassigned.length}</strong> lead{unassigned.length === 1 ? '' : 's'} unassigned — nobody is working them.
          </span>
          <button className="btn btn-sm btn-primary" onClick={handleClaimAll} disabled={claiming}>
            {claiming ? 'Claiming…' : `Claim all ${unassigned.length}`}
          </button>
        </div>
      )}

      {/* Bulk action bar — appears once anything's checked in Touches/Follow-ups */}
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
            {selectedIds.size} lead{selectedIds.size === 1 ? '' : 's'} selected
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button className="btn btn-sm btn-primary" onClick={handleBulkTouch} disabled={bulkBusy}>
              <Check size={14} /> {bulkBusy ? 'Working…' : 'Mark touched'}
            </button>
            <div style={{ position: 'relative' }}>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => setShowBulkSnooze(v => !v)}
                disabled={bulkBusy}
              >
                Snooze <ChevronDown size={12} />
              </button>
              {showBulkSnooze && (
                <div
                  style={{
                    position: 'absolute', right: 0, top: '100%', marginTop: '4px', zIndex: 10,
                    background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)', minWidth: '120px', overflow: 'hidden'
                  }}
                >
                  {[[1, 'Tomorrow'], [3, '3 days'], [7, 'Next week']].map(([days, label]) => (
                    <button
                      key={days}
                      onClick={() => handleBulkSnooze(days)}
                      style={{
                        display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                        background: 'none', textAlign: 'left', cursor: 'pointer', fontSize: '13px',
                        color: '#374151'
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="btn btn-sm btn-secondary"
              onClick={handleBulkDismiss}
              disabled={bulkBusy}
              style={{ color: '#b91c1c' }}
            >
              <XCircle size={14} /> Mark dead
            </button>
            <button className="btn btn-sm btn-secondary" onClick={clearSelection} disabled={bulkBusy}>
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Section 1 — Today's touches */}
      <SectionCard
        icon={<Check size={16} />}
        title="Today's touches"
        subtitle={`Top ${touchLeads.length} of ${queue.total} — ranked by stage weight × days stale × lead score`}
        headerExtra={touchLeads.length > 0 && (
          <SelectAllCheckbox
            ids={touchLeads.map(l => l.id)}
            selectedIds={selectedIds}
            onToggle={() => toggleSelectAll(touchLeads.map(l => l.id))}
          />
        )}
      >
        {touchLeads.length === 0 ? (
          queue.total === 0 ? (
            <EmptyState icon={<Inbox size={32} />} title="Queue clear 🎉">
              <button className="btn btn-primary btn-sm" onClick={handlePullMore} disabled={pullingMore}>
                <RefreshCw size={14} /> {pullingMore ? 'Checking…' : 'Pull 25 more'}
              </button>
            </EmptyState>
          ) : (
            <EmptyState title="All of today's top touches are in Follow-ups below." />
          )
        ) : (
          touchLeads.map(lead => (
            <TodayRow
              key={lead.id}
              lead={lead}
              settings={settings}
              busy={pendingId === lead.id}
              onTouched={handleTouched}
              onSnooze={handleSnooze}
              onDismiss={handleDismiss}
              selected={selectedIds.has(lead.id)}
              onToggleSelect={() => toggleSelect(lead.id)}
            />
          ))
        )}
      </SectionCard>

      {/* Section 2 — Follow-ups due */}
      <SectionCard
        icon={<AlarmClock size={16} />}
        title="Follow-ups due"
        subtitle="Engaged leads hitting the day 3 / 7 / 14 marks, or scheduled for today"
        headerExtra={followUps.length > 0 && (
          <SelectAllCheckbox
            ids={followUps.map(l => l.id)}
            selectedIds={selectedIds}
            onToggle={() => toggleSelectAll(followUps.map(l => l.id))}
          />
        )}
      >
        {followUps.length === 0 ? (
          <EmptyState title="No follow-ups due." />
        ) : (
          followUps.map(lead => (
            <TodayRow
              key={lead.id}
              lead={lead}
              settings={settings}
              busy={pendingId === lead.id}
              onTouched={handleTouched}
              onSnooze={handleSnooze}
              onDismiss={handleDismiss}
              contextOverride={followUpContext(lead)}
              selected={selectedIds.has(lead.id)}
              onToggleSelect={() => toggleSelect(lead.id)}
            />
          ))
        )}
      </SectionCard>

      {/* Section 3 — Escalate to Dev */}
      <SectionCard
        icon={<Megaphone size={16} />}
        title="Escalate to Dev"
        subtitle={isAdmin ? 'Across all owners — deals going quiet that need Dev' : 'Deals going quiet that need Dev'}
      >
        {escalations.length === 0 ? (
          <EmptyState title="Nothing to escalate." />
        ) : (
          escalations.map(lead => (
            <EscalationRow
              key={lead.id}
              lead={lead}
              settings={settings}
              busy={pendingId === lead.id}
              pinged={pingedIds.has(lead.id)}
              ownerName={isAdmin ? (personById.get(lead.assigned_to)?.name || 'Unassigned') : null}
              onPing={handlePingDev}
            />
          ))
        )}
      </SectionCard>
    </div>
  )
}

function SectionCard({ icon, title, subtitle, headerExtra, children }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '16px' }}>
      <div style={{ padding: '14px 18px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: '#111827', fontSize: '15px' }}>
            {icon} {title}
          </div>
          {subtitle && <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{subtitle}</div>}
        </div>
        {headerExtra}
      </div>
      <div style={{ padding: '10px' }}>{children}</div>
    </div>
  )
}

// Header checkbox for a section — selects/deselects every visible row.
function SelectAllCheckbox({ ids, selectedIds, onToggle }) {
  const allSelected = ids.length > 0 && ids.every(id => selectedIds.has(id))
  return (
    <button
      className="btn btn-sm btn-secondary"
      onClick={onToggle}
      title={allSelected ? 'Deselect all' : 'Select all'}
      style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}
    >
      {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
      Select all
    </button>
  )
}

function EmptyState({ icon, title, children }) {
  return (
    <div style={{ padding: '28px 16px', textAlign: 'center', color: '#6b7280' }}>
      {icon && <div style={{ color: '#9ca3af', marginBottom: '8px' }}>{icon}</div>}
      <div style={{ fontSize: '14px', marginBottom: children ? '12px' : 0 }}>{title}</div>
      {children}
    </div>
  )
}

// One-line context: where the lead came from and when it was last worked.
function touchContext(lead) {
  const parts = []
  if (lead.lead_source) parts.push(lead.lead_source)
  if (lead.last_activity_date) {
    const type = (lead.last_activity_type || 'activity').replace(/_/g, ' ')
    parts.push(`last: ${type} ${fmtDate(String(lead.last_activity_date).slice(0, 10))} (${daysStaleFor(lead)}d ago)`)
  } else {
    parts.push('never touched')
  }
  return parts.join(' · ')
}

function followUpContext(lead) {
  const today = istToday()
  // The note is the whole point of scheduling — surface it in the row so the
  // rep doesn't have to open the lead to remember what they promised.
  const note = lead.follow_up_note ? ` — “${lead.follow_up_note}”` : ''
  const cadence = lead.follow_up_cadence?.offsets?.length
    ? ` · ${lead.follow_up_cadence.name} ${Math.min(lead.follow_up_cadence.step, lead.follow_up_cadence.offsets.length)}/${lead.follow_up_cadence.offsets.length}`
    : ''
  if (lead.next_follow_up_date && lead.next_follow_up_date <= today) {
    const when = lead.next_follow_up_date === today
      ? 'follow-up scheduled for today'
      : `follow-up was scheduled for ${fmtDate(lead.next_follow_up_date)}`
    return when + cadence + note
  }
  return `day ${daysStaleFor(lead)} since last touch — cadence mark`
}

function TodayRow({ lead, settings, busy, onTouched, onSnooze, onDismiss, contextOverride, selected, onToggleSelect }) {
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)
  const [showSnooze, setShowSnooze] = useState(false)

  function submitTouch() {
    onTouched(lead, note)
    setNote('')
    setShowNote(false)
  }

  function confirmDismiss() {
    if (window.confirm(`Mark ${lead.name || 'this lead'} as a dead lead (stage → Passed)? It leaves your queue.`)) {
      onDismiss(lead)
    }
  }

  return (
    <div style={{ borderBottom: '1px solid #f3f4f6', padding: '12px 10px', opacity: busy ? 0.5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggleSelect}
            disabled={busy}
            aria-label={`Select ${lead.name || 'lead'}`}
            style={{ width: '16px', height: '16px', flexShrink: 0, cursor: 'pointer' }}
          />
        )}
        <div style={{ flex: 1, minWidth: '220px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 500, color: '#111827', fontSize: '14px' }}>
              {lead.name || 'Unknown'}
            </span>
            {lead.firm_name && <span style={{ color: '#6b7280', fontSize: '13px' }}>— {lead.firm_name}</span>}
            <StageChip stage={lead.stage} />
            {settings && <StalenessBadge lead={lead} settings={settings} />}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
            {contextOverride || touchContext(lead)}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            className="btn btn-sm btn-primary"
            onClick={submitTouch}
            disabled={busy}
            title="Log a touch and clear from today's queue"
          >
            <Check size={14} /> Touched
          </button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setShowNote(v => !v)}
            disabled={busy}
            title="Add an optional one-line note to the touch"
          >
            + note
          </button>
          <Link to={`/leads/${lead.id}`} className="btn btn-sm btn-secondary">
            Open
          </Link>
          {lead.linkedin_url && (
            <a
              href={lead.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm btn-secondary"
              title="Open LinkedIn profile"
            >
              <ExternalLink size={14} />
            </a>
          )}
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => setShowSnooze(v => !v)}
              disabled={busy}
              title="Push this lead to a later day"
            >
              Snooze <ChevronDown size={12} />
            </button>
            {showSnooze && (
              <div
                style={{
                  position: 'absolute', right: 0, top: '100%', marginTop: '4px', zIndex: 10,
                  background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)', minWidth: '120px', overflow: 'hidden'
                }}
              >
                {[[1, 'Tomorrow'], [3, '3 days'], [7, 'Next week']].map(([days, label]) => (
                  <button
                    key={days}
                    onClick={() => { setShowSnooze(false); onSnooze(lead, days) }}
                    style={{
                      display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                      background: 'none', textAlign: 'left', cursor: 'pointer', fontSize: '13px',
                      color: '#374151'
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="btn btn-sm btn-secondary"
            onClick={confirmDismiss}
            disabled={busy}
            title="Mark as a dead lead (stage → Passed) and remove from the queue"
            style={{ color: '#b91c1c' }}
          >
            <XCircle size={14} /> Dead
          </button>
        </div>
      </div>

      {showNote && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !busy) submitTouch() }}
            placeholder="One-line note — logged with the touch (Enter to log)"
            autoFocus
            style={{
              flex: 1, padding: '6px 8px', fontSize: '13px',
              border: '1px solid #e5e7eb', borderRadius: '4px'
            }}
          />
        </div>
      )}
    </div>
  )
}

function EscalationRow({ lead, settings, busy, pinged, ownerName, onPing }) {
  const days = daysStaleFor(lead)
  const reason = lead.stage === 'active_conversation'
    ? `active conversation silent ${days}d`
    : `${lead.budget_discussed ? 'budget discussed' : 'close date set'}, stalling ${days}d`

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
      padding: '12px 10px', borderBottom: '1px solid #f3f4f6', opacity: busy ? 0.5 : 1
    }}>
      <div style={{ flex: 1, minWidth: '220px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 500, color: '#111827', fontSize: '14px' }}>
            {lead.name || 'Unknown'}
          </span>
          {lead.firm_name && <span style={{ color: '#6b7280', fontSize: '13px' }}>— {lead.firm_name}</span>}
          <StageChip stage={lead.stage} />
          {settings && <StalenessBadge lead={lead} settings={settings} />}
          {ownerName && (
            <span style={{ fontSize: '12px', color: '#6b7280' }}>owner: {ownerName}</span>
          )}
        </div>
        <div style={{ fontSize: '12px', color: '#b45309', marginTop: '2px' }}>{reason}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => onPing(lead)}
          disabled={busy || pinged}
          title="Log an escalation note for Dev on this lead"
        >
          <Megaphone size={14} /> {pinged ? 'Pinged' : 'Ping Dev'}
        </button>
        <Link to={`/leads/${lead.id}`} className="btn btn-sm btn-secondary">
          Open
        </Link>
      </div>
    </div>
  )
}

export default Today
