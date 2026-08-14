import { useState, useEffect } from 'react'
import { AlarmClock, Check, X, Plus, Repeat } from 'lucide-react'
import {
  getFollowUpCadences,
  createFollowUpCadence,
  applyFollowUpCadence,
  setFollowUp,
  snoozeFollowUp,
  clearFollowUp,
  logFollowUpTouch
} from '../lib/crm-api'
import { istToday, istAddDays, fmtDate } from '../lib/dateUtils'
import { useToast } from './Toast'
import { notifyFollowUpsChanged } from '../hooks/useFollowUpCount'

const QUICK = [
  [1, 'Tomorrow'],
  [3, '3 days'],
  [7, '1 week'],
  [14, '2 weeks'],
  [30, '1 month']
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
    run(`Reach out again ${fmtDate(istAddDays(today, days))}`, () =>
      snoozeFollowUp(lead.id, days, { note }, currentPerson?.id))
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

  function handleClear() {
    run('Reminder cleared', () => clearFollowUp(lead.id, currentPerson?.id))
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
        padding: '10px 12px', borderRadius: '8px', marginBottom: '14px',
        background: overdue ? '#fef2f2' : due ? '#f0f9ff' : '#f9fafb',
        border: `1px solid ${overdue ? '#fecaca' : due ? '#bae6fd' : '#e5e7eb'}`
      }}>
        {due ? (
          <>
            <div style={{ fontSize: '14px', fontWeight: 600, color: overdue ? '#991b1b' : '#0c4a6e' }}>
              {overdue ? 'Overdue since ' : due === today ? 'Due today' : 'Scheduled for '}
              {due === today ? '' : fmtDate(due)}
            </div>
            {lead.follow_up_note && (
              <div style={{ fontSize: '13px', color: '#374151', marginTop: '4px' }}>
                “{lead.follow_up_note}”
              </div>
            )}
            {cadence?.offsets?.length > 0 && (
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Repeat size={12} /> {cadence.name} — touch {Math.min(cadence.step, cadence.offsets.length)} of {cadence.offsets.length}
                {' '}(days {cadence.offsets.join(' / ')} from {fmtDate(cadence.anchor)})
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: '13px', color: '#6b7280' }}>
            No reach-out scheduled — this lead only surfaces when it goes stale.
          </div>
        )}

        {due && (
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
            <button className="btn btn-sm btn-primary" onClick={handleReachedOut} disabled={busy}>
              <Check size={14} /> Reached out
            </button>
            <button className="btn btn-sm btn-secondary" onClick={handleClear} disabled={busy}>
              <X size={14} /> Clear
            </button>
          </div>
        )}
      </div>

      {/* Note — carried onto whatever gets scheduled below */}
      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
        What to say when you circle back
      </label>
      <input
        type="text"
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="e.g. Ask if the Q3 board approved the mandate"
        style={{ width: '100%', padding: '7px 9px', fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '6px', marginBottom: '12px' }}
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
          style={{ padding: '5px 8px', fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
        />
        <button className="btn btn-sm btn-secondary" onClick={handleCustomDate} disabled={busy || !customDate}>
          Set
        </button>
      </div>

      {/* Cadence */}
      <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '12px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
          Or put them on a cadence
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          <select
            value={cadenceId}
            onChange={e => setCadenceId(e.target.value)}
            style={{ padding: '6px 8px', fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '6px', minWidth: '200px' }}
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
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
          Each logged touch rolls the lead to the cadence's next day automatically.
        </div>

        {showNewCadence && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
            <input
              type="text"
              value={newCadence.name}
              onChange={e => setNewCadence(c => ({ ...c, name: e.target.value }))}
              placeholder="Cadence name"
              style={{ flex: '1 1 160px', padding: '6px 8px', fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
            />
            <input
              type="text"
              value={newCadence.offsets}
              onChange={e => setNewCadence(c => ({ ...c, offsets: e.target.value }))}
              placeholder="Days, e.g. 3, 10, 30"
              style={{ flex: '1 1 160px', padding: '6px 8px', fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
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
