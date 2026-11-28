import { useState, useEffect, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { snoozeOptions } from '../lib/snoozeOptions'
import { istToday } from '../lib/dateUtils'

/**
 * The one snooze dropdown (Dev, 2026-11-28: "add more options to the snooze").
 * Options come from src/lib/snoozeOptions.js so Today, the bulk bar and
 * Notifications always offer the same list.
 *
 * `onPick` receives `{ days }` (relative — the caller routes it through
 * snoozeFollowUp) or `{ date }` (exact — snoozeFollowUpTo), plus `label`.
 */
function SnoozeMenu({ onPick, disabled, label = 'Snooze', title = 'Push this lead to a later day', className = 'btn btn-sm btn-secondary' }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const ref = useRef(null)
  const today = istToday()

  // Close on a click anywhere else, so two open menus can't stack up a list.
  useEffect(() => {
    if (!open) return
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function pick(choice) {
    setOpen(false)
    setCustom('')
    onPick(choice)
  }

  const itemStyle = {
    display: 'block', width: '100%', padding: '7px 12px', border: 'none',
    background: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 'var(--fs-base)',
    color: 'var(--text-2)'
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className={className} onClick={() => setOpen(v => !v)} disabled={disabled} title={title}>
        {label} <ChevronDown size={12} />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', right: 0, top: '100%', marginTop: '4px', zIndex: 20,
            background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)', minWidth: '180px', overflow: 'hidden'
          }}
        >
          {snoozeOptions(today).map(o => (
            <button
              key={o.key}
              role="menuitem"
              onClick={() => pick(o.days ? { days: o.days, label: o.label } : { date: o.date, label: o.label })}
              style={{ ...itemStyle, borderTop: o.divider ? '1px solid var(--gray-100)' : 'none' }}
            >
              {o.label}
            </button>
          ))}
          <div style={{ borderTop: '1px solid var(--gray-100)', padding: '8px 10px', display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              type="date"
              value={custom}
              min={today}
              onChange={e => setCustom(e.target.value)}
              aria-label="Pick a date"
              style={{ flex: 1, padding: '4px 6px', fontSize: 'var(--fs-sm)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
            />
            <button
              className="btn btn-sm btn-primary"
              disabled={!custom || custom <= today}
              onClick={() => pick({ date: custom, label: custom })}
            >
              Set
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default SnoozeMenu
