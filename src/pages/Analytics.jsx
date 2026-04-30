import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../App'
import { getOutreachStatsByPerson } from '../lib/crm-api'
import { supabase } from '../lib/supabase'
import { Send, MessageSquare, Calendar, TrendingUp } from 'lucide-react'

// fromOffset = days back for range start, toOffset = days back for range end.
// e.g. Yesterday: from=1,to=1 — Today: from=0,to=0 — 7d: from=6,to=0
const TIME_WINDOWS = [
  { label: 'Today',     fromOffset: 0,  toOffset: 0 },
  { label: 'Yesterday', fromOffset: 1,  toOffset: 1 },
  { label: '3 days',    fromOffset: 2,  toOffset: 0 },
  { label: '7 days',    fromOffset: 6,  toOffset: 0 },
  { label: '30 days',   fromOffset: 29, toOffset: 0 },
  { label: '90 days',   fromOffset: 89, toOffset: 0 },
]

function getWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const mon = new Date(d)
  mon.setDate(diff)
  return mon.toISOString().split('T')[0]
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function fmtWeek(wk) {
  return new Date(wk + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '22px', fontWeight: '700', color: color || 'var(--primary)' }}>{value}</div>
      <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '2px' }}>{label}</div>
    </div>
  )
}

function Analytics() {
  const { people } = useApp()
  const [timeWin, setTimeWin] = useState(TIME_WINDOWS[3]) // default: 7 days
  const [outreachRows, setOutreachRows] = useState([])
  const [meetingRows, setMeetingRows] = useState([])
  const [loading, setLoading] = useState(true)
  // personFilter is always a string ('all' or stringified id) so it round-trips
  // cleanly through <select> e.target.value (which is always a string).
  const [personFilter, setPersonFilter] = useState('all')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const since = new Date()
      since.setDate(since.getDate() - 90)
      const sinceDate = since.toISOString().split('T')[0]

      const [outreach, meetings] = await Promise.all([
        getOutreachStatsByPerson(90),
        supabase
          .from('crm_lead_activities')
          .select('logged_by, activity_date, activity_type')
          .in('activity_type', ['call', 'meeting'])
          .gte('activity_date', sinceDate)
          .then(({ data, error }) => { if (error) throw error; return data || [] })
      ])
      setOutreachRows(outreach)
      setMeetingRows(meetings)
    } catch (e) {
      console.error('Analytics load failed', e)
    } finally {
      setLoading(false)
    }
  }

  const today = useMemo(() => todayStr(), [])
  const sinceDate = useMemo(() => addDays(today, -timeWin.fromOffset), [today, timeWin])
  const toDate   = useMemo(() => addDays(today, -timeWin.toOffset),   [today, timeWin])
  // Number of calendar days in the selected window (used for averages / heatmap)
  const days = timeWin.fromOffset - timeWin.toOffset + 1

  // People who have any outreach data in 90-day window.
  // Stringify ids so they match personFilter (always a string from <select>).
  const activePeople = useMemo(() => {
    const ids = new Set(outreachRows.map(r => String(r.logged_by)))
    return people.filter(p => ids.has(String(p.id)))
  }, [people, outreachRows])

  const visiblePeople = useMemo(() => {
    if (personFilter === 'all') return activePeople
    return activePeople.filter(p => String(p.id) === personFilter)
  }, [activePeople, personFilter])

  // Rows within the selected time window + person filter
  const filteredRows = useMemo(() => {
    return outreachRows.filter(r => {
      if (r.outreach_date < sinceDate) return false
      if (r.outreach_date > toDate) return false
      if (personFilter !== 'all' && String(r.logged_by) !== personFilter) return false
      return true
    })
  }, [outreachRows, sinceDate, toDate, personFilter])

  // Per-person aggregates
  const personStats = useMemo(() => {
    const map = {}
    for (const row of filteredRows) {
      const pid = row.logged_by
      if (!map[pid]) map[pid] = { total: 0, replies: 0, byDate: {} }
      map[pid].total += 1
      if (row.status === 'replied') map[pid].replies += 1
      map[pid].byDate[row.outreach_date] = (map[pid].byDate[row.outreach_date] || 0) + 1
    }
    return map
  }, [filteredRows])

  // Weekly breakdown per person
  const weeklyStats = useMemo(() => {
    const map = {}
    for (const row of filteredRows) {
      const pid = row.logged_by
      const wk = getWeekKey(row.outreach_date)
      if (!map[pid]) map[pid] = {}
      map[pid][wk] = (map[pid][wk] || 0) + 1
    }
    return map
  }, [filteredRows])

  // Sorted unique week keys within window
  const weekKeys = useMemo(() => {
    const wks = new Set()
    for (const row of filteredRows) wks.add(getWeekKey(row.outreach_date))
    return [...wks].sort().reverse()
  }, [filteredRows])

  // Meetings per week (filtered). Uses its own week-key set so weeks with
  // meetings but no outreach still appear in the meetings bar chart.
  const meetingsByWeek = useMemo(() => {
    const map = {}
    for (const row of meetingRows) {
      const date = (row.activity_date || '').split('T')[0]
      if (!date || date < sinceDate || date > toDate) continue
      if (personFilter !== 'all' && String(row.logged_by) !== personFilter) continue
      const wk = getWeekKey(date)
      map[wk] = (map[wk] || 0) + 1
    }
    return map
  }, [meetingRows, sinceDate, toDate, personFilter])

  // Week keys for the meetings bar — union of outreach weeks and meeting weeks
  const meetingWeekKeys = useMemo(() => {
    const wks = new Set([...weekKeys, ...Object.keys(meetingsByWeek)])
    return [...wks].sort().reverse().slice(0, 8)
  }, [weekKeys, meetingsByWeek])

  const totalMeetings = Object.values(meetingsByWeek).reduce((s, v) => s + v, 0)
  const weeksInWindow = Math.max(1, Math.ceil(days / 7))
  const annualProjection = Math.round((totalMeetings / weeksInWindow) * 52)
  const maxMeetingsWeek = Math.max(1, ...Object.values(meetingsByWeek))

  if (loading) {
    return <div className="loading">Loading analytics...</div>
  }

  return (
    <div>
      <div className="page-header">
        <h1>Analytics</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={personFilter}
            onChange={e => setPersonFilter(e.target.value)}
            className="form-select"
            style={{ minWidth: '140px' }}
          >
            <option value="all">All People</option>
            {activePeople.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {TIME_WINDOWS.map(tw => (
              <button
                key={tw.label}
                onClick={() => setTimeWin(tw)}
                className={timeWin.label === tw.label ? 'btn btn-primary' : 'btn btn-secondary'}
                style={{ padding: '6px 14px', fontSize: '13px' }}
              >
                {tw.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Per-person summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {visiblePeople.map(person => {
          const st = personStats[person.id] || { total: 0, replies: 0 }
          const replyRate = st.total > 0 ? Math.round((st.replies / st.total) * 100) : 0
          const dailyAvg = (st.total / days).toFixed(1)
          const weeklyAvg = (st.total / Math.max(1, Math.ceil(days / 7))).toFixed(1)
          const rateColor = replyRate >= 10 ? 'var(--success)' : replyRate >= 5 ? '#f59e0b' : 'inherit'
          return (
            <div key={person.id} className="card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: 'var(--primary)', color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: '600', fontSize: '14px', flexShrink: 0
                }}>
                  {person.name?.split(' ').map(n => n[0]).join('').slice(0, 2) || '?'}
                </div>
                <div>
                  <div style={{ fontWeight: '600', fontSize: '15px' }}>{person.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>{timeWin.label}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <StatBox label="Total" value={st.total} />
                <StatBox label="Daily avg" value={dailyAvg} />
                <StatBox label="Weekly avg" value={weeklyAvg} />
                <StatBox label="Reply rate" value={`${replyRate}%`} color={rateColor} />
              </div>
            </div>
          )
        })}
        {visiblePeople.length === 0 && (
          <div style={{ gridColumn: '1/-1', padding: '48px', textAlign: 'center', color: 'var(--gray-500)' }}>
            No outreach data in this window.
          </div>
        )}
      </div>

      {/* Weekly outreach table */}
      {weekKeys.length > 0 && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h2 style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Send size={18} /> Weekly Outreach
          </h2>
          <p style={{ color: 'var(--gray-500)', fontSize: '14px', marginBottom: '20px' }}>
            Outreach logged per person per week
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--gray-200)' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '600', whiteSpace: 'nowrap' }}>Person</th>
                  {weekKeys.map(wk => (
                    <th key={wk} style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '600', whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--gray-600)' }}>
                      w/{fmtWeek(wk)}
                    </th>
                  ))}
                  <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '600' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {visiblePeople.map(person => {
                  const pw = weeklyStats[person.id] || {}
                  const personTotal = Object.values(pw).reduce((s, v) => s + v, 0)
                  return (
                    <tr key={person.id} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: '500', whiteSpace: 'nowrap' }}>{person.name}</td>
                      {weekKeys.map(wk => {
                        const count = pw[wk] || 0
                        return (
                          <td key={wk} style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <span style={{
                              display: 'inline-block', minWidth: '28px',
                              padding: '2px 8px', borderRadius: '12px', fontSize: '13px',
                              background: count >= 50 ? '#dcfce7' : count >= 20 ? '#fef9c3' : count > 0 ? 'var(--gray-100)' : 'transparent',
                              color: count >= 50 ? '#166534' : count >= 20 ? '#713f12' : 'inherit',
                              fontWeight: count > 0 ? '600' : '400'
                            }}>
                              {count || '—'}
                            </span>
                          </td>
                        )
                      })}
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '700', color: 'var(--primary)' }}>
                        {personTotal}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reply rate + Meetings */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {/* Reply rate */}
        <div className="card">
          <h2 style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MessageSquare size={18} /> Reply Rate
          </h2>
          <p style={{ color: 'var(--gray-500)', fontSize: '14px', marginBottom: '20px' }}>
            Replies received / outreach sent
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {visiblePeople.map(person => {
              const st = personStats[person.id] || { total: 0, replies: 0 }
              const rate = st.total > 0 ? (st.replies / st.total) * 100 : 0
              const rateColor = rate >= 10 ? 'var(--success)' : rate >= 5 ? '#f59e0b' : 'var(--gray-600)'
              return (
                <div key={person.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', fontSize: '14px' }}>
                    <span style={{ fontWeight: '500' }}>{person.name}</span>
                    <span style={{ fontWeight: '700', color: rateColor }}>
                      {Math.round(rate)}%{' '}
                      <span style={{ fontWeight: '400', color: 'var(--gray-500)', fontSize: '12px' }}>
                        ({st.replies}/{st.total})
                      </span>
                    </span>
                  </div>
                  <div style={{ height: '8px', background: 'var(--gray-200)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min(100, rate)}%`, height: '100%', borderRadius: '4px',
                      background: rate >= 10 ? 'var(--success)' : rate >= 5 ? '#f59e0b' : 'var(--primary)',
                      transition: 'width 0.4s ease'
                    }} />
                  </div>
                </div>
              )
            })}
            {visiblePeople.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-500)' }}>No data</div>
            )}
          </div>
        </div>

        {/* Meetings booked */}
        <div className="card">
          <h2 style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar size={18} /> Meetings Booked
          </h2>
          <p style={{ color: 'var(--gray-500)', fontSize: '14px', marginBottom: '20px' }}>
            Calls & meetings logged
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            <div style={{ textAlign: 'center', padding: '16px', background: 'var(--gray-50)', borderRadius: '8px' }}>
              <div style={{ fontSize: '32px', fontWeight: '700', color: 'var(--primary)' }}>{totalMeetings}</div>
              <div style={{ fontSize: '13px', color: 'var(--gray-500)', marginTop: '4px' }}>{timeWin.label}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '16px', background: 'var(--gray-50)', borderRadius: '8px' }}>
              <div style={{ fontSize: '32px', fontWeight: '700', color: 'var(--success)' }}>{annualProjection}</div>
              <div style={{ fontSize: '13px', color: 'var(--gray-500)', marginTop: '4px' }}>Annual run rate</div>
            </div>
          </div>
          {meetingWeekKeys.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {meetingWeekKeys.map(wk => {
                const count = meetingsByWeek[wk] || 0
                return (
                  <div key={wk} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                    <div style={{ width: '64px', color: 'var(--gray-500)', flexShrink: 0, fontSize: '12px' }}>
                      {fmtWeek(wk)}
                    </div>
                    <div style={{ flex: 1, height: '14px', background: 'var(--gray-100)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{
                        width: `${(count / maxMeetingsWeek) * 100}%`, height: '100%',
                        background: 'var(--primary)', borderRadius: '3px'
                      }} />
                    </div>
                    <div style={{ width: '20px', textAlign: 'right', fontWeight: '600' }}>{count || '—'}</div>
                  </div>
                )
              })}
            </div>
          )}
          {meetingWeekKeys.length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-500)' }}>No meeting data</div>
          )}
        </div>
      </div>

      {/* Daily heatmap — shown when a single person is selected */}
      {personFilter !== 'all' && visiblePeople.length === 1 && (
        <div className="card">
          <h2 style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TrendingUp size={18} /> Daily Activity — {visiblePeople[0].name}
          </h2>
          <p style={{ color: 'var(--gray-500)', fontSize: '14px', marginBottom: '16px' }}>
            Each square = one day. Darker = more outreach.
          </p>
          {(() => {
            const st = personStats[visiblePeople[0].id] || { byDate: {} }
            const maxDay = Math.max(1, ...Object.values(st.byDate))
            const dates = []
            for (let i = timeWin.fromOffset; i >= timeWin.toOffset; i--) dates.push(addDays(today, -i))
            const colors = ['var(--gray-100)', '#bbf7d0', '#4ade80', '#22c55e', '#15803d']
            return (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {dates.map(date => {
                  const count = st.byDate[date] || 0
                  const intensity = count === 0 ? 0 : Math.min(4, Math.ceil((count / maxDay) * 4))
                  return (
                    <div
                      key={date}
                      title={`${date}: ${count} outreach`}
                      style={{
                        width: days <= 30 ? '26px' : '18px',
                        height: days <= 30 ? '26px' : '18px',
                        borderRadius: '4px',
                        background: colors[intensity],
                        cursor: 'default',
                        flexShrink: 0
                      }}
                    />
                  )
                })}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

export default Analytics
