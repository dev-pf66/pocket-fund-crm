import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { getFollowUpNotifications } from '../lib/crm-api'
import { istToday, fmtDate } from '../lib/dateUtils'

// Reminders don't move minute to minute; a 5-minute poll keeps the badge
// honest across a long-lived tab without hammering Supabase.
const POLL_MS = 5 * 60 * 1000

/**
 * Sidebar bell: how many of your scheduled reach-outs are due or overdue.
 * Red when something has actually slipped, neutral when today's are simply
 * waiting. Clicking a lead opens it; "See all" goes to Today, which is still
 * the place the day's work gets done.
 */
function NotificationBell({ personId }) {
  const navigate = useNavigate()
  const [data, setData] = useState({ total: 0, overdue: 0, dueToday: 0, leads: [] })
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  const load = useCallback(() => {
    if (!personId) return
    getFollowUpNotifications(personId)
      .then(setData)
      .catch(err => console.error('Notification load failed:', err))
  }, [personId])

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  // Close on outside click so the panel doesn't sit over the nav.
  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const today = istToday()

  return (
    <div ref={wrapRef} style={{ position: 'relative', marginBottom: '12px' }}>
      <button
        onClick={() => { setOpen(v => !v); if (!open) load() }}
        title="Follow-ups due"
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
          padding: '7px 10px', background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
          color: 'inherit', opacity: 0.75, cursor: 'pointer', fontSize: '13px', textAlign: 'left'
        }}
      >
        <Bell size={14} /> Follow-ups
        {data.total > 0 && (
          <span style={{
            marginLeft: 'auto', minWidth: '20px', padding: '1px 6px', borderRadius: '999px',
            fontSize: '11px', fontWeight: 700, textAlign: 'center',
            background: data.overdue > 0 ? '#dc2626' : '#2563eb', color: 'white'
          }}>
            {data.total}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', zIndex: 50,
          background: 'white', color: '#111827', border: '1px solid #e5e7eb',
          borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', overflow: 'hidden'
        }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6', fontSize: '12px', color: '#6b7280' }}>
            {data.total === 0
              ? 'Nothing due'
              : `${data.overdue} overdue · ${data.dueToday} due today`}
          </div>

          {data.leads.map(l => (
            <button
              key={l.id}
              onClick={() => { setOpen(false); navigate(`/leads/${l.id}`) }}
              style={{
                display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                borderBottom: '1px solid #f9fafb', background: 'none', textAlign: 'left', cursor: 'pointer'
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 500 }}>
                {l.name || 'Unknown'}
                {l.firm_name && <span style={{ color: '#6b7280', fontWeight: 400 }}> — {l.firm_name}</span>}
              </div>
              <div style={{ fontSize: '11px', color: l.next_follow_up_date < today ? '#b91c1c' : '#6b7280' }}>
                {l.next_follow_up_date < today ? `overdue since ${fmtDate(l.next_follow_up_date)}` : 'due today'}
                {l.follow_up_note ? ` · ${l.follow_up_note}` : ''}
              </div>
            </button>
          ))}

          {data.total > data.leads.length && (
            <div style={{ padding: '6px 12px', fontSize: '11px', color: '#6b7280' }}>
              +{data.total - data.leads.length} more
            </div>
          )}

          <button
            onClick={() => { setOpen(false); navigate('/today') }}
            style={{
              display: 'block', width: '100%', padding: '9px 12px', border: 'none',
              background: '#f9fafb', textAlign: 'center', cursor: 'pointer',
              fontSize: '12px', fontWeight: 600, color: '#2563eb'
            }}
          >
            Work them in Today →
          </button>
        </div>
      )}
    </div>
  )
}

export default NotificationBell
