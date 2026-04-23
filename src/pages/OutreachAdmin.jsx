import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getAllOutreachLogs, getOutreachStatsByPerson, updateOutreach } from '../lib/crm-api'
import { useApp } from '../App'
import { Target, ChevronDown, ChevronUp, Filter, Check, Flame, Trophy, TrendingUp } from 'lucide-react'
import { useToast } from '../components/Toast'
import { useSessionState } from '../hooks/useSessionState'

const DAILY_GOAL = 10
const WEEKLY_GOAL = 50

const PLATFORM_LABELS = {
  cold_email: 'Email',
  linkedin_message: 'LinkedIn',
  phone_call: 'Phone',
  other: 'Other'
}

const PLATFORMS = ['cold_email', 'linkedin_message', 'phone_call', 'other']

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

// Monday-anchored week start.
function weekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  const offset = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + offset)
  return d.toISOString().split('T')[0]
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

function formatShort(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function FitStars({ score }) {
  if (!score) return <span style={{ color: '#9ca3af', fontSize: '13px' }}>—</span>
  return (
    <span>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ color: i < score ? '#f59e0b' : '#d1d5db', fontSize: '14px' }}>★</span>
      ))}
    </span>
  )
}

// Compute dashboard metrics from a person's daily count buckets.
// dailyCounts: Map<dateStr, number>
function computeMetrics(dailyCounts) {
  const today = todayStr()
  const todayCount = dailyCounts.get(today) || 0

  // Streak: consecutive days meeting the daily goal. Include today if hit;
  // otherwise count backward from yesterday so a mid-day lull doesn't erase
  // the streak.
  let streak = 0
  let cursor = todayCount >= DAILY_GOAL ? today : addDays(today, -1)
  while ((dailyCounts.get(cursor) || 0) >= DAILY_GOAL) {
    streak += 1
    cursor = addDays(cursor, -1)
  }

  // Weekly: Mon-Sun ending this week.
  const thisWeekStart = weekStart(today)
  let thisWeekCount = 0
  for (let i = 0; i < 7; i += 1) {
    thisWeekCount += dailyCounts.get(addDays(thisWeekStart, i)) || 0
  }

  // Personal bests across the loaded window.
  let bestDay = { date: null, count: 0 }
  const weekBuckets = new Map()
  for (const [date, count] of dailyCounts) {
    if (count > bestDay.count) bestDay = { date, count }
    const ws = weekStart(date)
    weekBuckets.set(ws, (weekBuckets.get(ws) || 0) + count)
  }
  let bestWeek = { start: null, count: 0 }
  for (const [start, count] of weekBuckets) {
    if (count > bestWeek.count) bestWeek = { start, count }
  }

  // 14-day sparkline (oldest first).
  const sparkline = []
  for (let i = 13; i >= 0; i -= 1) {
    const date = addDays(today, -i)
    sparkline.push({ date, count: dailyCounts.get(date) || 0 })
  }

  return { todayCount, streak, thisWeekCount, bestDay, bestWeek, sparkline, thisWeekStart }
}

function ProgressRing({ value, goal, size = 96, stroke = 8, color = '#2563eb' }) {
  const pct = Math.min(1, value / goal)
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const dash = circ * pct
  const hit = value >= goal
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={hit ? '#16a34a' : color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
          style={{ transition: 'stroke-dasharray 0.4s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center'
      }}>
        <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </div>
        <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
          / {goal}
        </div>
      </div>
    </div>
  )
}

function Sparkline({ data, goal = DAILY_GOAL }) {
  const max = Math.max(goal, ...data.map(d => d.count))
  const today = todayStr()
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '60px' }}>
      {data.map(d => {
        const h = max > 0 ? Math.round((d.count / max) * 100) : 0
        const hit = d.count >= goal
        const isToday = d.date === today
        return (
          <div key={d.date} title={`${formatShort(d.date)}: ${d.count}`} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px'
          }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
              <div style={{
                width: '100%',
                height: `${Math.max(h, 2)}%`,
                background: hit ? '#16a34a' : (d.count > 0 ? '#93c5fd' : '#e5e7eb'),
                borderRadius: '3px 3px 0 0',
                outline: isToday ? '2px solid #2563eb' : 'none',
                outlineOffset: '1px',
                transition: 'height 0.3s ease'
              }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WeeklyBar({ value, goal }) {
  const pct = Math.min(100, (value / goal) * 100)
  const hit = value >= goal
  return (
    <div>
      <div style={{
        height: '10px', background: '#e5e7eb', borderRadius: '999px', overflow: 'hidden'
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: hit ? '#16a34a' : 'linear-gradient(90deg, #3b82f6, #2563eb)',
          transition: 'width 0.4s ease'
        }} />
      </div>
    </div>
  )
}

function Nudge({ todayCount, streak, thisWeekCount, bestDay }) {
  const remaining = DAILY_GOAL - todayCount
  let text, tone
  if (todayCount === 0) {
    text = 'Log your first outreach to get on the board today.'
    tone = 'info'
  } else if (remaining > 0 && remaining <= 3) {
    text = `${remaining} away from today's goal — you got this.`
    tone = 'warn'
  } else if (remaining > 0) {
    text = `${remaining} more to hit today's goal.`
    tone = 'info'
  } else if (streak >= 3) {
    text = `🔥 ${streak}-day streak — don't break it tomorrow.`
    tone = 'good'
  } else if (bestDay?.count && todayCount > bestDay.count) {
    text = `New personal best! ${todayCount} in a single day.`
    tone = 'good'
  } else {
    text = "Goal hit for today. Keep the momentum going."
    tone = 'good'
  }
  const styles = {
    good: { bg: '#f0fdf4', fg: '#166534', border: '#bbf7d0' },
    warn: { bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
    info: { bg: '#eff6ff', fg: '#1e40af', border: '#bfdbfe' }
  }[tone]
  return (
    <div style={{
      padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
      background: styles.bg, color: styles.fg, border: `1px solid ${styles.border}`
    }}>
      {text}
    </div>
  )
}

function AnalystDashboard({ personName, metrics }) {
  const { todayCount, streak, thisWeekCount, bestDay, bestWeek, sparkline } = metrics
  return (
    <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '18px', flexWrap: 'wrap', gap: '10px'
      }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Today's Progress
          </div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>
            {personName}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 12px', borderRadius: '999px', background: streak > 0 ? '#fff7ed' : '#f3f4f6', border: `1px solid ${streak > 0 ? '#fed7aa' : '#e5e7eb'}` }}>
          <Flame size={16} style={{ color: streak > 0 ? '#ea580c' : '#9ca3af' }} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: streak > 0 ? '#9a3412' : '#6b7280' }}>
            {streak} day{streak === 1 ? '' : 's'} streak
          </span>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '24px',
        alignItems: 'center',
        marginBottom: '18px'
      }}>
        <ProgressRing value={todayCount} goal={DAILY_GOAL} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                This Week
              </span>
              <span style={{ fontSize: '13px', color: '#111827', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {thisWeekCount} <span style={{ color: '#6b7280', fontWeight: 500 }}>/ {WEEKLY_GOAL}</span>
              </span>
            </div>
            <WeeklyBar value={thisWeekCount} goal={WEEKLY_GOAL} />
          </div>
          <Nudge todayCount={todayCount} streak={streak} thisWeekCount={thisWeekCount} bestDay={bestDay} />
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '12px',
        marginBottom: '16px'
      }}>
        <StatTile
          icon={<Trophy size={14} />}
          label="Personal best day"
          value={bestDay.count || 0}
          sub={bestDay.date ? formatShort(bestDay.date) : '—'}
        />
        <StatTile
          icon={<TrendingUp size={14} />}
          label="Personal best week"
          value={bestWeek.count || 0}
          sub={bestWeek.start ? `week of ${formatShort(bestWeek.start)}` : '—'}
        />
      </div>

      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
          Last 14 days
        </div>
        <Sparkline data={sparkline} />
      </div>
    </div>
  )
}

function StatTile({ icon, label, value, sub }) {
  return (
    <div style={{
      padding: '12px 14px',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      background: '#fafafa'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#6b7280', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
        {icon}
        {label}
      </div>
      <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '3px' }}>
        {sub}
      </div>
    </div>
  )
}

function OutreachAdmin() {
  const { toast } = useToast()
  const { currentPerson, people } = useApp()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useSessionState('oa:expandedId', null)
  const [togglingId, setTogglingId] = useState(null)

  // Lightweight stats across everyone for 90 days; drives dashboard + pills.
  const [statsRows, setStatsRows] = useState([])
  const [statsLoading, setStatsLoading] = useState(true)

  const [filters, setFilters] = useSessionState('oa:filters', {
    platform: '',
    days_back: '',
    has_response: '',
    logged_by: ''
  })

  // Who the dashboard focuses on. Persisted separately so managers can
  // inspect teammates without losing the table filter they had.
  const [focusedPersonId, setFocusedPersonId] = useSessionState('oa:focusedPersonId', null)

  useEffect(() => {
    loadEntries()
  }, [filters])

  useEffect(() => {
    loadStats()
  }, [])

  useEffect(() => {
    if (focusedPersonId == null && currentPerson?.id) {
      setFocusedPersonId(String(currentPerson.id))
    }
  }, [currentPerson?.id])

  async function loadEntries() {
    setLoading(true)
    try {
      const applied = {}
      if (filters.platform) applied.platform = filters.platform
      if (filters.days_back) applied.days_back = parseInt(filters.days_back)
      if (filters.has_response === 'yes') applied.has_response = true
      if (filters.has_response === 'no') applied.has_response = false

      const data = await getAllOutreachLogs(applied)
      setEntries(data)
    } catch (err) {
      console.error('Failed to load outreach logs:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadStats() {
    setStatsLoading(true)
    try {
      const rows = await getOutreachStatsByPerson(90)
      setStatsRows(rows)
    } catch (err) {
      console.error('Failed to load outreach stats:', err)
    } finally {
      setStatsLoading(false)
    }
  }

  // Build Map<personId, Map<date, count>> from the lightweight rows.
  const dailyByPerson = useMemo(() => {
    const out = new Map()
    for (const r of statsRows) {
      const pid = r.logged_by ?? 'unassigned'
      if (!out.has(pid)) out.set(pid, new Map())
      const m = out.get(pid)
      m.set(r.outreach_date, (m.get(r.outreach_date) || 0) + 1)
    }
    return out
  }, [statsRows])

  const today = todayStr()

  // People list for the switcher: anyone who has logged at least one
  // outreach in the last 90 days, plus the current person even if they
  // haven't yet (so they see a "0 today" card to kick things off).
  const switcherPeople = useMemo(() => {
    const ids = new Set(dailyByPerson.keys())
    if (currentPerson?.id) ids.add(currentPerson.id)
    const list = []
    for (const id of ids) {
      if (id === 'unassigned') continue
      const person = people?.find(p => p.id === id)
      const name = person?.name || `Person ${id}`
      const todayCount = dailyByPerson.get(id)?.get(today) || 0
      list.push({ id, name, todayCount })
    }
    return list.sort((a, b) => {
      if (a.id === currentPerson?.id) return -1
      if (b.id === currentPerson?.id) return 1
      return b.todayCount - a.todayCount
    })
  }, [dailyByPerson, people, currentPerson?.id, today])

  const focusedPerson = switcherPeople.find(p => String(p.id) === String(focusedPersonId))
  const focusedMetrics = useMemo(() => {
    if (!focusedPerson) return null
    const buckets = dailyByPerson.get(focusedPerson.id) || new Map()
    return computeMetrics(buckets)
  }, [focusedPerson?.id, dailyByPerson])

  const visibleEntries = filters.logged_by
    ? entries.filter(e => String(e.logged_by ?? 'unassigned') === String(filters.logged_by))
    : entries

  const totalCount = visibleEntries.length
  const withResponse = visibleEntries.filter(e => e.status === 'replied').length

  async function toggleResponded(entry, e) {
    e.stopPropagation()
    const next = entry.status === 'replied' ? 'sent' : 'replied'
    setTogglingId(entry.id)
    try {
      await updateOutreach(entry.id, { status: next })
      setEntries(prev => prev.map(x => x.id === entry.id ? { ...x, status: next } : x))
      toast.success(next === 'replied' ? 'Marked as responded' : 'Marked as no response')
    } catch (err) {
      console.error('Failed to toggle status:', err)
      toast.error('Failed to update status')
    } finally {
      setTogglingId(null)
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    })
  }

  function toggleExpand(id) {
    setExpandedId(prev => prev === id ? null : id)
  }

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
            <Target size={24} /> Outreach Log
          </h1>
          <p style={{ color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
            Daily targets, streaks, and every outreach across the team
          </p>
        </div>
      </div>

      {/* Analyst dashboard */}
      {!statsLoading && focusedPerson && focusedMetrics && (
        <AnalystDashboard personName={focusedPerson.name} metrics={focusedMetrics} />
      )}

      {/* Team switcher — today-focused pills */}
      {!statsLoading && switcherPeople.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Team today
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {switcherPeople.map(p => {
              const isActive = String(focusedPersonId) === String(p.id)
              const hit = p.todayCount >= DAILY_GOAL
              return (
                <button
                  key={p.id}
                  onClick={() => setFocusedPersonId(String(p.id))}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '999px',
                    border: isActive ? '1.5px solid #2563eb' : '1px solid #e5e7eb',
                    background: isActive ? '#eff6ff' : 'white',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    color: '#111827',
                    fontWeight: 500,
                    transition: 'border-color 0.12s, background 0.12s'
                  }}
                >
                  <span>{p.name}</span>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    background: hit ? '#dcfce7' : '#f3f4f6',
                    color: hit ? '#15803d' : '#4b5563',
                    fontVariantNumeric: 'tabular-nums'
                  }}>
                    {p.todayCount}/{DAILY_GOAL}
                    {hit && ' ✓'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Filter size={16} style={{ color: '#6b7280' }} />

          <select
            value={filters.logged_by}
            onChange={e => setFilters(f => ({ ...f, logged_by: e.target.value }))}
            className="form-control"
            style={{ width: 'auto', fontSize: '13px' }}
          >
            <option value="">All Team Members</option>
            {switcherPeople.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <select
            value={filters.platform}
            onChange={e => setFilters(f => ({ ...f, platform: e.target.value }))}
            className="form-control"
            style={{ width: 'auto', fontSize: '13px' }}
          >
            <option value="">All Platforms</option>
            {PLATFORMS.map(p => (
              <option key={p} value={p}>{PLATFORM_LABELS[p] || p}</option>
            ))}
          </select>

          <select
            value={filters.days_back}
            onChange={e => setFilters(f => ({ ...f, days_back: e.target.value }))}
            className="form-control"
            style={{ width: 'auto', fontSize: '13px' }}
          >
            <option value="">All Time</option>
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>

          <select
            value={filters.has_response}
            onChange={e => setFilters(f => ({ ...f, has_response: e.target.value }))}
            className="form-control"
            style={{ width: 'auto', fontSize: '13px' }}
          >
            <option value="">All (response or not)</option>
            <option value="yes">Got response</option>
            <option value="no">No response</option>
          </select>

          <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#6b7280' }}>
            <strong style={{ color: '#111827', fontWeight: 600 }}>{totalCount}</strong> shown
            {totalCount > 0 && (
              <> · <strong style={{ color: '#15803d', fontWeight: 600 }}>{withResponse}</strong> replied
                ({Math.round((withResponse / totalCount) * 100)}%)
              </>
            )}
          </div>

          {(filters.platform || filters.days_back || filters.has_response || filters.logged_by) && (
            <button
              className="btn btn-sm"
              onClick={() => setFilters({ platform: '', days_back: '', has_response: '', logged_by: '' })}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 12px' }}></div>
            Loading outreach logs…
          </div>
        ) : visibleEntries.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
            No outreach entries found.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Lead (Company)</th>
                <th style={thStyle}>Platform</th>
                <th style={thStyle}>Logged By</th>
                <th style={thStyle}>Message Preview</th>
                <th style={thStyle}>Fit</th>
                <th style={thStyle}>Response?</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map(entry => (
                <>
                  <tr
                    key={entry.id}
                    style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                    onClick={() => toggleExpand(entry.id)}
                  >
                    <td style={tdStyle}>{formatDate(entry.outreach_date)}</td>
                    <td style={tdStyle}>
                      {entry.lead ? (
                        <Link
                          to={`/leads/${entry.lead.id}`}
                          onClick={e => e.stopPropagation()}
                          style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: '500' }}
                        >
                          {entry.lead_name || entry.lead.name}
                          {(entry.firm_name || entry.lead.firm_name) && (
                            <span style={{ display: 'block', fontSize: '12px', color: '#6b7280', fontWeight: '400' }}>
                              {entry.firm_name || entry.lead.firm_name}
                            </span>
                          )}
                        </Link>
                      ) : (
                        <span>
                          {entry.lead_name}
                          {entry.firm_name && (
                            <span style={{ display: 'block', fontSize: '12px', color: '#6b7280' }}>
                              {entry.firm_name}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span className="badge badge-secondary" style={{ fontSize: '11px' }}>
                        {PLATFORM_LABELS[entry.outreach_type] || entry.outreach_type || '—'}
                      </span>
                    </td>
                    <td style={tdStyle}>{entry.logged_by_person?.name || '—'}</td>
                    <td style={{ ...tdStyle, maxWidth: '260px' }}>
                      <span style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: '13px',
                        color: '#4b5563'
                      }}>
                        {entry.message_content || entry.notes || <em style={{ color: '#9ca3af' }}>No message</em>}
                      </span>
                    </td>
                    <td style={tdStyle}><FitStars score={entry.fit_score} /></td>
                    <td style={tdStyle}>
                      <button
                        onClick={(ev) => toggleResponded(entry, ev)}
                        disabled={togglingId === entry.id}
                        title={entry.status === 'replied' ? 'Click to mark as no response' : 'Click to mark as responded'}
                        style={{
                          background: 'none',
                          border: entry.status === 'replied' ? '1px solid #bbf7d0' : '1px dashed #e5e7eb',
                          borderRadius: '999px',
                          padding: '3px 10px',
                          fontSize: '12px',
                          fontWeight: entry.status === 'replied' ? 600 : 400,
                          color: entry.status === 'replied' ? '#15803d' : '#9ca3af',
                          cursor: togglingId === entry.id ? 'wait' : 'pointer'
                        }}
                      >
                        {entry.status === 'replied' ? <><Check size={12} /> Responded</> : 'Mark responded'}
                      </button>
                    </td>
                    <td style={tdStyle}>
                      {expandedId === entry.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </td>
                  </tr>

                  {expandedId === entry.id && (
                    <tr key={`${entry.id}-expanded`} style={{ background: '#fafafa', borderBottom: '1px solid #e5e7eb' }}>
                      <td colSpan={8} style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                          {entry.message_content && (
                            <div>
                              <div style={{ fontSize: '11px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px' }}>
                                Message Content
                              </div>
                              <div style={{
                                background: 'white',
                                border: '1px solid #e5e7eb',
                                borderRadius: '6px',
                                padding: '12px',
                                fontSize: '13px',
                                lineHeight: '1.6',
                                whiteSpace: 'pre-wrap',
                                maxHeight: '200px',
                                overflowY: 'auto'
                              }}>
                                {entry.message_content}
                              </div>
                            </div>
                          )}

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {entry.platform_details && (
                              <div>
                                <div style={metaLabelStyle}>Platform Details</div>
                                <div style={metaValueStyle}>{entry.platform_details}</div>
                              </div>
                            )}
                            {entry.industry && (
                              <div>
                                <div style={metaLabelStyle}>Industry</div>
                                <div style={metaValueStyle}>{entry.industry}</div>
                              </div>
                            )}
                            {entry.deal_size && (
                              <div>
                                <div style={metaLabelStyle}>Deal Size</div>
                                <div style={metaValueStyle}>{entry.deal_size}</div>
                              </div>
                            )}
                            {entry.location && (
                              <div>
                                <div style={metaLabelStyle}>Location</div>
                                <div style={metaValueStyle}>{entry.location}</div>
                              </div>
                            )}
                            {entry.lead_source && (
                              <div>
                                <div style={metaLabelStyle}>Lead Source</div>
                                <div style={metaValueStyle}>{entry.lead_source}</div>
                              </div>
                            )}
                            {entry.notes && (
                              <div>
                                <div style={metaLabelStyle}>Notes</div>
                                <div style={metaValueStyle}>{entry.notes}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const thStyle = {
  padding: '10px 16px',
  textAlign: 'left',
  fontSize: '12px',
  fontWeight: '600',
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em'
}

const tdStyle = {
  padding: '12px 16px',
  fontSize: '14px',
  verticalAlign: 'middle'
}

const metaLabelStyle = {
  fontSize: '11px',
  fontWeight: '600',
  color: '#6b7280',
  textTransform: 'uppercase',
  marginBottom: '4px'
}

const metaValueStyle = {
  fontSize: '13px',
  color: '#374151',
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: '4px',
  padding: '6px 10px'
}

export default OutreachAdmin
