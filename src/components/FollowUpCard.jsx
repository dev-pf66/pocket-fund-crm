import { useState, useEffect } from 'react'
import { AlarmClock, Check, X, Plus, Repeat } from 'lucide-react'
import {
  getFollowUpCadences,
  createFollowUpCadence,
  applyFollowUpCadence,
  setFollowUp,
  snoozeFollowUp,
  DEFAULT_FOLLOW_UP_DAYS,
  logFollowUpTouch
} from '../lib/crm-api'
import { istToday, istAddDays, fmtDate } from '../lib/dateUtils'
import { useToast } from './Toast'
import { notifyFollowUpsChanged } from '../hooks/useNotificationCount'
import LeadUpdateBox from './LeadUpdateBox'

const QUICK = [
  [1, 'Tomorrow'],
  [3, '3 days'],
  [7, '1 week'],
  [14, '2 weeks'],
  [30, '1 month'],
  [91, '3 months'],
  [182, '6 months']
]

/**
 * Per-lead reach-out scheduler: one date, one reason, and one click to put the
 * lead on a reusable multi-touch cadence. Writes to
 * crm_leads.next_follow_up_date — the same field the Today tab, the lead
 * cards and the Notifications page all read, so anything scheduled here shows
 * up everywhere without a second sync path.
 *
 * `onChange` receives the updated lead so the parent can refresh in place, or
 * null when the parent should refetch (the "Reached out" path writes an
 * activity as well as the lead).
 */
function FollowUpCard({ lead, currentPerson, onChange }) {
  const { toast } = useToast()
  const [cadences, setCadences] = useState([])
  const [note, setNote] = useState(lead.follow_up_note || '')
  const [customDate, setCustomDate] = useState('')
  const [cadenceId, setCadenceId] = useState('')
  const [showNewCadence, setShowNewCadence] = useState(false)
  const [newCadence, setNewCadence] = useState({ name: '', offsets: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getFollowUpCadences()
      .then(setCadences)
      .catch(err => console.error('Cadence load failed:', err))
  }, [])

  useEffect(() => {
    setNote(lead.follow_up_note || '')
  }, [lead.id, lead.follow_up_note])

  const today = istToday()
  const due = lead.next_follow_up_date
  const overdue = due && due < today
  const cadence = lead.follow_up_cadence

  // Every action funnels through here so busy-state, errors and the parent
  // refresh are handled once instead of six times.
  async function run(label, fn) {
    setBusy(true)
    try {
      const updated = await fn()
      if (onChange) onChange(updated ?? null)
      notifyFollowUpsChanged()
      toast.success(label)
    } catch (err) {
      console.error(`${label} failed:`, err)
      toast.error(`Failed: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  function handleQuick(days) {
    // Mirrors snoozeFollowUp: defer from the promised date when it's still
    // ahead of us, otherwise from today.
    const base = due && due > today ? due : today
    run(`Reach out again ${fmtDate(istAddDays(base, days))}`, () =>
      snoozeFollowUp(lead, days, { note }, currentPerson?.id))
  }

  function handleCustomDate() {
    if (!customDate) return
    run(`Reach out again ${fmtDate(customDate)}`, () =>
      setFollowUp(lead.id, { date: customDate, note }, currentPerson?.id))
  }

  function handleApplyCadence() {
    const chosen = cadences.find(c => String(c.id) === String(cadenceId))
    if (!chosen) return
    run(`Cadence "${chosen.name}" applied`, () =>
      applyFollowUpCadence(lead.id, chosen, { note }, currentPerson?.id))
  }

  function handleReachedOut() {
    // Returns null → the parent refetches, picking up both the new activity
    // and the cadence's next date.
    run('Reach-out logged', async () => {
      await logFollowUpTouch(lead, currentPerson?.id, { note: '' })
      return null
    })
  }

  // There is no "no reminder" for a live lead (Dev, 2026-11-16) — what used to
  // be Clear now pushes the reminder to the default check-in.
  function handleClear() {
    // Same as Notifications' +30d: pushes from the later of today or the date
    // already set, keeps a running cadence, never pulls a reminder earlier.
    run(`Pushed ${DEFAULT_FOLLOW_UP_DAYS} days`, () =>
      snoozeFollowUp(lead, DEFAULT_FOLLOW_UP_DAYS, { note: lead.follow_up_note }, currentPerson?.id))
  }

  async function handleCreateCadence() {
    const offsets = newCadence.offsets.split(/[,\s]+/).map(Number).filter(n => n > 0)
    if (!newCadence.name.trim() || offsets.length === 0) {
      toast.error('Cadence needs a name and at least one day offset')
      return
    }
    setBusy(true)
    try {
      const created = await createFollowUpCadence(
        { name: newCadence.name, offsets },
        currentPerson?.id
      )
      setCadences(prev => [...prev, created])
      setCadenceId(String(created.id))
      setShowNewCadence(false)
      setNewCadence({ name: '', offsets: '' })
      toast.success(`Cadence "${created.name}" saved — available on every lead`)
    } catch (err) {
      console.error('Cadence create failed:', err)
      toast.error(`Failed: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ opacity: busy ? 0.6 : 1 }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <AlarmClock size={20} /> Reach back out
      </h2>

      {/* Current reminder */}
      <div style={{
        padding: '10px 12px', borderRadius: 'var(--radius-md)', marginBottom: '14px',
        background: overdue ? 'var(--danger-bg)' : due ? '#f0f9ff' : 'var(--surface-subtle)',
        border: `1px solid ${overdue ? 'var(--danger-border)' : due ? '#bae6fd' : 'var(--border)'}`
      }}>
        {due ? (
          <>
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: overdue ? 'var(--danger-text-strong)' : '#0c4a6e' }}>
              {overdue ? 'Overdue since ' : due === today ? 'Due today' : 'Scheduled for '}
              {due === today ? '' : fmtDate(due)}
            </div>
            {lead.follow_up_note && (
              <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text-2)', marginTop: '4px' }}>
                “{lead.follow_up_note}”
              </div>
            )}
            {cadence?.offsets?.length > 0 && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Repeat size={12} /> {cadence.name} — touch {Math.min(cadence.step, cadence.offsets.length)} of {cadence.offsets.length}
                {' '}(days {cadence.offsets.join(' / ')} from {fmtDate(cadence.anchor)})
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)' }}>
            No reach-out scheduled — this lead only surfaces when it goes stale.
          </div>
        )}

        {due && (
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
            <button className="btn btn-sm btn-primary" onClick={handleReachedOut} disabled={busy}>
              <Check size={14} /> Reached out
            </button>
            <button className="btn btn-sm btn-secondary" onClick={handleClear} disabled={busy}
              title={`Push the reminder back ${DEFAULT_FOLLOW_UP_DAYS} days. Only marking the lead dead ends reminders.`}>
              <AlarmClock size={14} /> +{DEFAULT_FOLLOW_UP_DAYS} days
            </button>
          </div>
        )}
      </div>

      {/* Typed update (Dev, 2026-11-28): say what happened, the date is read
          from the words and confirmed before saving. */}
      <label style={{ display: 'block', fontSize: 'var(--fs-base)', fontWeight: 600, marginBottom: '4px' }}>
        Log an update
      </label>
      <div style={{ marginBottom: '14px' }}>
        <LeadUpdateBox lead={lead} currentPerson={currentPerson} onSaved={res => {
          // The lead row (new reminder) first, then null so the page also
          // refetches activities — the update is a new activity too.
          if (!onChange) return
          if (res?.lead) onChange(res.lead)
          onChange(null)
        }} />
      </div>

      <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: '12px' }} />

      {/* Note — carried onto whatever gets scheduled below */}
      <label style={{ display: 'block', fontSize: 'var(--fs-base)', fontWeight: 600, marginBottom: '4px' }}>
        What to say when you circle back
      </label>
      <input
        type="text"
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="e.g. Ask if the Q3 board approved the mandate"
        style={{ width: '100%', padding: '7px 9px', fontSize: 'var(--fs-base)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: '12px' }}
      />

      {/* Quick schedule */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginBottom: '12px' }}>
        {QUICK.map(([days, label]) => (
          <button key={days} className="btn btn-sm btn-secondary" onClick={() => handleQuick(days)} disabled={busy}>
            {label}
          </button>
        ))}
        <input
          type="date"
          value={customDate}
          min={today}
          onChange={e => setCustomDate(e.target.value)}
          style={{ padding: '5px 8px', fontSize: 'var(--fs-base)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
        />
        <button className="btn btn-sm btn-secondary" onClick={handleCustomDate} disabled={busy || !customDate}>
          Set
        </button>
      </div>

      {/* Cadence */}
      <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: '12px' }}>
        <label style={{ display: 'block', fontSize: 'var(--fs-base)', fontWeight: 600, marginBottom: '4px' }}>
          Or put them on a cadence
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          <select
            value={cadenceId}
            onChange={e => setCadenceId(e.target.value)}
            style={{ padding: '6px 8px', fontSize: 'var(--fs-base)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', minWidth: '200px' }}
          >
            <option value="">Select a cadence…</option>
            {cadences.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} — days {c.offsets.join(' / ')}
              </option>
            ))}
          </select>
          <button className="btn btn-sm btn-primary" onClick={handleApplyCadence} disabled={busy || !cadenceId}>
            <Repeat size={14} /> Apply
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => setShowNewCadence(v => !v)} disabled={busy}>
            <Plus size={14} /> New
          </button>
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: '6px' }}>
          Each logged touch rolls the lead to the cadence's next day automatically.
        </div>

        {showNewCadence && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
            <input
              type="text"
              value={newCadence.name}
              onChange={e => setNewCadence(c => ({ ...c, name: e.target.value }))}
              placeholder="Cadence name"
              style={{ flex: '1 1 160px', padding: '6px 8px', fontSize: 'var(--fs-base)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
            />
            <input
              type="text"
              value={newCadence.offsets}
              onChange={e => setNewCadence(c => ({ ...c, offsets: e.target.value }))}
              placeholder="Days, e.g. 3, 10, 30"
              style={{ flex: '1 1 160px', padding: '6px 8px', fontSize: 'var(--fs-base)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
            />
            <button className="btn btn-sm btn-primary" onClick={handleCreateCadence} disabled={busy}>
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default FollowUpCard
