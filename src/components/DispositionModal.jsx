import { useState } from 'react'
import { X, Skull, CalendarClock, Briefcase, Handshake, Play } from 'lucide-react'
import { disposeLead } from '../lib/crm-api'
import { useApp } from '../App'
import { useToast } from './Toast'
import { useFieldOptions } from '../hooks/useFieldOptions'
import { istToday, istAddDays } from '../lib/dateUtils'

/**
 * The 30-day update. Dev, 27 Sept 2026: "the person who's responsible for the
 * lead has to update it... if the lead is dead we have to mark it as dead, or if
 * they've said get back to me after three months we need a way for the person to
 * be updated like that. So we know exactly what's happening with each of our
 * leads."
 *
 * Five answers, one of which keeps the lead live. Two are validated rather than
 * suggested, because both are the specific failure this replaces:
 *   - dead REQUIRES a reason, from an admin-editable dropdown (Dev: "there should
 *     be a reason and the reason why should be a drop down, to which they can add
 *     more reasons... the administration can be in the admin side"). The
 *     vocabulary lives in crm_field_options, so Admin → field options extends it
 *     with no deploy.
 *   - later REQUIRES a date. "Get back to me in three months" with no date on
 *     file is indistinguishable from forgetting.
 *
 * This is the one place in the lead-health work that does gate — and it gates
 * the CONTENT of a deliberate action the user chose to take, not the ability to
 * save a lead. The flag itself still blocks nothing.
 */

const CHOICES = [
  { key: 'working',  label: 'Still working it', Icon: Play,          hint: 'Nothing is wrong — answers the clock for another 30 days' },
  { key: 'later',    label: 'Come back later',  Icon: CalendarClock, hint: 'They asked us to check in on a specific date' },
  { key: 'dead',     label: 'Mark dead',        Icon: Skull,         hint: 'Out of the pipeline, with the reason on record' },
  { key: 'investor', label: 'Better as an investor', Icon: Briefcase, hint: 'Hand to the investor book' },
  { key: 'partner',  label: 'Better as a partner',   Icon: Handshake, hint: 'Hand to partners' },
]

function DispositionModal({ lead, onClose, onDone }) {
  const { currentPerson } = useApp()
  const { toast } = useToast()
  const deadReasons = useFieldOptions('dead_reason', 'Pick a reason…')

  const [choice, setChoice] = useState(null)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  // A sensible default that is still obviously a choice — 3 months is the
  // example Dev used on the call.
  const [date, setDate] = useState(() => istAddDays(istToday(), 90))
  const [saving, setSaving] = useState(false)

  const needsReason = choice === 'dead'
  const needsDate = choice === 'later'
  const canSave = Boolean(choice) && (!needsReason || reason) && (!needsDate || date)

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      const updated = await disposeLead(lead.id, {
        disposition: choice,
        reason: needsReason ? reason : null,
        note: note.trim() || null,
        followUpDate: needsDate ? date : null,
      }, currentPerson?.id)
      toast.success('Lead updated — clock reset')
      onDone?.(updated)
      onClose?.()
    } catch (error) {
      console.error('Disposition failed:', error)
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <h2 style={{ margin: 0, fontSize: '18px' }}>What is happening with {lead.name}?</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '14px' }}>
          Nobody has updated this lead in over 30 days. Pick one — whichever you pick,
          it stays in the CRM.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
          {CHOICES.map(c => (
            <button
              key={c.key}
              onClick={() => setChoice(c.key)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '10px', textAlign: 'left',
                padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
                border: `1px solid ${choice === c.key ? '#2563eb' : '#e5e7eb'}`,
                background: choice === c.key ? '#eff6ff' : 'white',
              }}
            >
              <c.Icon size={16} style={{ flexShrink: 0, marginTop: '2px', color: choice === c.key ? '#2563eb' : '#6b7280' }} />
              <span>
                <span style={{ fontWeight: 600, fontSize: '14px' }}>{c.label}</span>
                <span style={{ display: 'block', fontSize: '12px', color: '#6b7280' }}>{c.hint}</span>
              </span>
            </button>
          ))}
        </div>

        {needsReason && (
          <div className="form-group" style={{ marginBottom: '10px' }}>
            <label>Why? <span style={{ color: '#b91c1c' }}>*</span></label>
            <select className="form-select" value={reason} onChange={(e) => setReason(e.target.value)}>
              {deadReasons.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
              Missing an option? Admin → field options, <code>dead_reason</code>.
            </div>
          </div>
        )}

        {needsDate && (
          <div className="form-group" style={{ marginBottom: '10px' }}>
            <label>Come back on <span style={{ color: '#b91c1c' }}>*</span></label>
            <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        )}

        <div className="form-group" style={{ marginBottom: '16px' }}>
          <label>What happened? {choice === 'dead' ? '(optional detail)' : ''}</label>
          <textarea
            className="form-input" rows={3} value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="One line the next person would want to know"
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Saving…' : 'Update lead'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default DispositionModal
