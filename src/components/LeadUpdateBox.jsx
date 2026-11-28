import { useState, useMemo } from 'react'
import { Sparkles, CalendarClock } from 'lucide-react'
import { logLeadUpdate, parseReminderWithAI } from '../lib/crm-api'
import { parseReminder } from '../lib/reminderParse'
import { istToday } from '../lib/dateUtils'
import { useToast } from './Toast'
import { notifyFollowUpsChanged } from '../hooks/useNotificationCount'

/** "Mon, Jan 4, 2027" — the year matters when the reminder is months out. */
function fmtLongDate(iso) {
  if (!iso) return ''
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  })
}

/**
 * Type what happened, get a reminder (Dev, 2026-11-28): "I can type in 'reach
 * out in the start of the new year' and then it pops up on Today in Jan."
 *
 * The date is read live from the note by src/lib/reminderParse.js (free,
 * instant). If it can't find one, "Read it with Claude" asks the server — a
 * deliberate click, so typing never spends API credits. Either way the date is
 * SHOWN, editable, before anything is saved: a guessed date nobody saw would
 * put the lead on the wrong day silently.
 *
 * Saving logs the update on the lead's history and sets the reminder
 * (logLeadUpdate). `onSaved(result)` lets the parent drop the row or refetch.
 */
function LeadUpdateBox({ lead, currentPerson, followUp = false, onSaved, onCancel, autoFocus = false, compact = false }) {
  const { toast } = useToast()
  const today = istToday()
  const [text, setText] = useState('')
  const [manualDate, setManualDate] = useState('')
  const [ai, setAi] = useState(null) // { date, rule, forText }
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)

  const local = useMemo(() => parseReminder(text, today), [text, today])
  // A Claude answer only counts for the exact text it read.
  const aiHit = ai && ai.forText === text ? ai : null

  const date = manualDate || local?.date || aiHit?.date || ''
  const source = manualDate ? 'you picked it'
    : local ? `read as “${local.rule}”`
      : aiHit?.date ? `Claude read it as “${aiHit.rule || 'that date'}”`
        : null

  async function readWithClaude() {
    setReading(true)
    try {
      const res = await parseReminderWithAI(text)
      setAi({ ...res, forText: text })
      if (!res.date) toast.error('Claude couldn’t find a date in that — pick one below')
    } catch (err) {
      console.error('Reminder read failed:', err)
      toast.error(`Couldn’t read it: ${err.message}. Pick the date below.`)
    } finally {
      setReading(false)
    }
  }

  async function save() {
    if (!text.trim() || !date || saving) return
    setSaving(true)
    try {
      const result = await logLeadUpdate(lead, { text, date }, currentPerson?.id, { followUp })
      notifyFollowUpsChanged()
      toast.success(`Update logged — ${lead.name || 'lead'} comes back ${fmtLongDate(date)}`)
      setText(''); setManualDate(''); setAi(null)
      if (onSaved) onSaved(result)
    } catch (err) {
      console.error('Update failed:', err)
      toast.error(`Failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '7px 9px', fontSize: 'var(--fs-base)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', fontFamily: 'inherit', resize: 'vertical'
  }

  return (
    <div style={{ opacity: saving ? 0.6 : 1 }}>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}
        placeholder="What happened? e.g. “Spoke to him — fund closes in Q1, reach out at the start of the new year”"
        rows={compact ? 2 : 3}
        autoFocus={autoFocus}
        style={inputStyle}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
        <CalendarClock size={15} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-2)' }}>Reach out on</span>
        <input
          type="date"
          value={date}
          min={today}
          onChange={e => setManualDate(e.target.value)}
          aria-label="Reach out on"
          style={{ padding: '4px 7px', fontSize: 'var(--fs-base)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
        />
        {date && (
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text)' }}>{fmtLongDate(date)}</strong>{source ? ` · ${source}` : ''}
          </span>
        )}
        {!date && text.trim().length > 3 && (
          <button className="btn btn-sm btn-secondary" onClick={readWithClaude} disabled={reading}
            title="No date found in your note — ask Claude to read it (you still confirm the date before saving)">
            <Sparkles size={13} /> {reading ? 'Reading…' : 'Read it with Claude'}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
        <button className="btn btn-sm btn-primary" onClick={save} disabled={saving || !text.trim() || !date}
          title={!date ? 'Needs a date — type one in the note or pick it' : 'Log the update and set the reminder'}>
          {saving ? 'Saving…' : 'Save update'}
        </button>
        {onCancel && (
          <button className="btn btn-sm btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        )}
      </div>
    </div>
  )
}

export default LeadUpdateBox
