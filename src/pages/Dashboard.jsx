import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getCRMDashboardData, getOutreachStatsByPerson, getWeeklyFunnel, getMovementWeekOverWeek, cachePeek } from '../lib/crm-api'
import { useApp } from '../App'
import { istToday, istAddDays, istWeekStart, fmtDate } from '../lib/dateUtils'
import { TrendingUp, AlertCircle, Calendar, Activity, Clock, FlaskConical, Target } from 'lucide-react'
import { isAdminUser } from '../lib/admin'
import { buildDailyCounts, computeMetrics, replyRateColor } from '../lib/outreachMetrics'
import StageChip from '../components/StageChip'

const FUNNEL_WEEK_OPTIONS = [4, 8, 12]

// Selectable window for the team summary card. IST calendar weeks are
// Mon–Sun, matching the funnel and streak math everywhere else.
const SUMMARY_RANGES = [
  { key: 'this_week', label: 'This Week' },
  { key: 'last_week', label: 'Last Week' },
  { key: '7d', label: '7 Days' },
  { key: '14d', label: '14 Days' },
  { key: '30d', label: '30 Days' }
]
// Longest window any preset needs — one fetch covers every selection.
const SUMMARY_FETCH_DAYS = 35

function summaryRangeBounds(key, today) {
  if (key === 'this_week') return { start: istWeekStart(today), end: today }
  if (key === 'last_week') {
    const ws = istWeekStart(today)
    return { start: istAddDays(ws, -7), end: istAddDays(ws, -1) }
  }
  const days = parseInt(key, 10) || 7
  return { start: istAddDays(today, -(days - 1)), end: today }
}

// Shared pill-row selector used by the summary and funnel cards.
function RangePills({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #e5e7eb', borderRadius: '999px', overflow: 'hidden', background: 'white' }}>
      {options.map(opt => {
        const active = value === opt.key
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            style={{
              padding: '4px 10px', fontSize: '12px', border: 'none', cursor: 'pointer',
              fontWeight: active ? 600 : 500,
              color: active ? '#1d4ed8' : '#6b7280',
              background: active ? '#eff6ff' : 'transparent',
              whiteSpace: 'nowrap'
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// Per-user outreach targets are set by the admin (Admin → All Users).
// Zero — or unset — means NO target, and every goal ring, progress bar and
// "N to go" line hides rather than dividing by it. Sales moved to a
// deliberately low-volume, high-targeting motion (Dev, Aug 2026), so holding
// everyone to a daily send quota measured the wrong thing. The old 10/50
// fallbacks are gone; `?? ` not `||` so an explicit 0 survives.
export const DEFAULT_DAILY_TARGET = 0
export const DEFAULT_WEEKLY_TARGET = 0
export const dailyTargetOf = (person) => person?.daily_outreach_target ?? DEFAULT_DAILY_TARGET
export const weeklyTargetOf = (person) => person?.weekly_outreach_target ?? DEFAULT_WEEKLY_TARGET
/** True when this person has a real quota to be measured against. */
export const hasTarget = (t) => Number(t) > 0

const PIPELINE_SEGMENTS = [
  { key: 'new_lead',             label: 'New',       color: '#a78bfa' },
  { key: 'cold_outreach',        label: 'Cold',      color: '#60a5fa' },
  { key: 'responded',            label: 'Responded', color: '#06b6d4' },
  { key: 'warm_lead',            label: 'Warm',      color: '#fbbf24' },
  { key: 'active_conversation',  label: 'Active',    color: '#f97316' },
  { key: 'meeting_booked',       label: 'Meeting',   color: '#ec4899' },
  { key: 'client',               label: 'Clients',   color: '#22c55e' },
]

function daysSince(dateStr) {
  if (!dateStr) return null
  return Math.ceil((Date.now() - new Date(dateStr)) / (1000 * 60 * 60 * 24))
}

function Dashboard() {
  const { currentPerson, people } = useApp()
  const isAdmin = isAdminUser(currentPerson)
  // Non-admins only see their own card on the per-person grids; admins
  // see the full team. Mirrors the data isolation we already enforce on
  // the underlying queries via RLS.
  const visiblePeople = useMemo(
    () => isAdmin
      ? (people || [])
      : (currentPerson ? [currentPerson] : []),
    [isAdmin, people, currentPerson]
  )
  const cacheKey = 'dashboard:' + (currentPerson?.id ?? 'all')
  const [data, setData] = useState(() => cachePeek(cacheKey) || null)
  const [outreachRows, setOutreachRows] = useState([])
  // Gamification (self-only): 90 days of own rows for streak/bests, plus
  const [personalRows, setPersonalRows] = useState([])
  const [movement, setMovement] = useState({ advanced: 0, replies: 0, meetings: 0, live: 0, sampleFrom: null })
  const [prevMovement, setPrevMovement] = useState(null)
  // Admin-only weekly funnel (outreach → replies → meetings → demos).
  const [funnel, setFunnel] = useState([])
  const [funnelWeeks, setFunnelWeeks] = useState(8)
  const [summaryRange, setSummaryRange] = useState('this_week')
  const [loading, setLoading] = useState(() => !cachePeek(cacheKey))

  useEffect(() => {
    loadData()
  }, [currentPerson?.id, isAdmin])

  // Funnel refetches on its own when the weeks window changes.
  useEffect(() => {
    if (!currentPerson?.id || !isAdmin) return
    getWeeklyFunnel(funnelWeeks, null).then(setFunnel).catch(() => {})
  }, [currentPerson?.id, isAdmin, funnelWeeks])

  async function loadData() {
    if (!currentPerson?.id) return
    try {
      const [dashboardData, rows, myRows, moveRes] = await Promise.all([
        getCRMDashboardData(currentPerson.id),
        // Admins get all-team rows; non-admins only their own. Fetched wide
        // enough for every summary-range preset, filtered client-side.
        getOutreachStatsByPerson(SUMMARY_FETCH_DAYS, isAdmin ? null : currentPerson.id).catch(() => []),
        getOutreachStatsByPerson(90, currentPerson.id).catch(() => []),
        getMovementWeekOverWeek(currentPerson.id).catch(err => {
          console.error('Movement stats failed:', err)
          return null
        })
      ])
      setData(dashboardData)
      setOutreachRows(rows)
      setPersonalRows(myRows)
      if (moveRes) {
        setMovement(moveRes.current)
        setPrevMovement(moveRes.previous)
      }
    } catch (error) {
      console.error('Failed to load dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const myDailyTarget = dailyTargetOf(currentPerson)
  const myMetrics = useMemo(
    () => computeMetrics(buildDailyCounts(personalRows), myDailyTarget),
    [personalRows, myDailyTarget]
  )

  const today = istToday()
  const { start: rangeStart, end: rangeEnd } = summaryRangeBounds(summaryRange, today)
  const rangeLabel = SUMMARY_RANGES.find(r => r.key === summaryRange)?.label || 'This Week'

  // Today's counts, independent of the selected summary range.
  const todayCounts = useMemo(() => {
    const map = new Map()
    for (const r of outreachRows) {
      if (r.outreach_date === today) map.set(r.logged_by, (map.get(r.logged_by) || 0) + 1)
    }
    return map
  }, [outreachRows, today])

  // Today's list order: me pinned top, then by count desc, then name — so the
  // leader is obvious at a glance in the compact row layout.
  const todayPeople = useMemo(() => {
    return [...visiblePeople].sort((a, b) => {
      const aMe = a.id === currentPerson?.id, bMe = b.id === currentPerson?.id
      if (aMe !== bMe) return aMe ? -1 : 1
      const ca = todayCounts.get(a.id) || 0, cb = todayCounts.get(b.id) || 0
      if (cb !== ca) return cb - ca
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [visiblePeople, todayCounts, currentPerson?.id])

  // Per-person stats within the selected summary range.
  const personStats = useMemo(() => {
    const map = new Map()
    for (const r of outreachRows) {
      if (r.outreach_date < rangeStart || r.outreach_date > rangeEnd) continue
      if (!map.has(r.logged_by)) {
        map.set(r.logged_by, { count: 0, replies: 0 })
      }
      const s = map.get(r.logged_by)
      s.count += 1
      if (r.status === 'replied') s.replies += 1
    }
    return map
  }, [outreachRows, rangeStart, rangeEnd])

  // Team totals for the selected range
  const teamWeek = useMemo(() => {
    let total = 0, replies = 0
    for (const s of personStats.values()) {
      total += s.count
      replies += s.replies
    }
    return { total, replies, replyRate: total > 0 ? Math.round((replies / total) * 100) : 0 }
  }, [personStats])

  if (loading && !data) {
    return (
      <div>
        <div className="page-header"><h1>Dashboard</h1></div>
        <div className="loading">Loading dashboard...</div>
      </div>
    )
  }

  if (!data) return <div>Error loading dashboard</div>

  const { pipelineStats, staleLeads, followUps, needsSamples, activeStale } = data
  const hasAlerts = activeStale.length || staleLeads.length || followUps.length || needsSamples.length

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>Dashboard</h1>
        <Link to="/outreach" className="btn btn-primary">Log Outreach</Link>
      </div>

      {/* My Week — what moved, self-only data */}
      <MyWeekCard movement={movement} prevMovement={prevMovement} touchesThisWeek={myMetrics.thisWeekCount} />

      {/* Today's Outreach */}
      <div className="card dashboard-card">
        <div className="dashboard-card-header">
          <h2><Activity size={20} /> Today's Outreach</h2>
          <span className="dashboard-date-label">{fmtDate(today)}</span>
        </div>
        <div className="today-outreach-list">
          {todayPeople.map(person => {
            const todayCount = todayCounts.get(person.id) || 0
            const personTarget = dailyTargetOf(person)
            const pct = hasTarget(personTarget) ? Math.min(100, (todayCount / personTarget) * 100) : 0
            const hit = hasTarget(personTarget) && todayCount >= personTarget
            const isMe = person.id === currentPerson?.id
            return (
              <div key={person.id} className={`today-outreach-row${isMe ? ' today-outreach-row-me' : ''}`}>
                <span className="person-outreach-name">
                  {person.name}
                  {isMe && <span className="person-outreach-you">you</span>}
                </span>
                <div className="today-outreach-row-bar">
                  <div className={`today-outreach-row-fill${hit ? ' hit' : ''}`} style={{ width: `${pct}%` }} />
                </div>
                <span className={`today-outreach-row-count${hit ? ' hit' : ''}`}>
                  {todayCount}<span className="goal"> / {personTarget}</span>
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Team summary — selectable window */}
      <div className="card dashboard-card">
        <div className="dashboard-card-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
          <h2><Calendar size={20} /> {isAdmin ? rangeLabel : `My ${rangeLabel}`}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <RangePills options={SUMMARY_RANGES} value={summaryRange} onChange={setSummaryRange} />
            <span className="dashboard-date-label">{fmtDate(rangeStart)} – {fmtDate(rangeEnd)}</span>
          </div>
        </div>
        <div className="week-summary-grid">
          <div className="week-stat-block">
            <div className="week-stat-value">{teamWeek.total}</div>
            <div className="week-stat-label">Total Outreach</div>
          </div>
          <div className="week-stat-block">
            <div className="week-stat-value">{teamWeek.replies}</div>
            <div className="week-stat-label">Replies</div>
          </div>
          <div className="week-stat-block">
            <div className="week-stat-value" style={{ color: replyRateColor(teamWeek.replyRate, teamWeek.total) }}>
              {teamWeek.replyRate}%
            </div>
            <div className="week-stat-label">Reply Rate</div>
          </div>
          {/* "Avg / Person" only makes sense when looking at the team —
              hide it for non-admins who only see their own row. */}
          {isAdmin && (
            <div className="week-stat-block">
              <div className="week-stat-value">
                {visiblePeople.length > 0 ? Math.round(teamWeek.total / visiblePeople.length) : 0}
              </div>
              <div className="week-stat-label">Avg / Person</div>
            </div>
          )}
        </div>

        {/* Per-person weekly breakdown — only shown for admins; non-admins
            see their own numbers in the summary tiles above. */}
        {isAdmin && visiblePeople.length > 0 && (
          <div className="week-person-table">
            <div className="week-person-header">
              <span>Person</span>
              <span>Outreach</span>
              <span>Replies</span>
              <span>Rate</span>
            </div>
            {visiblePeople.map(person => {
              const s = personStats.get(person.id) || { count: 0, replies: 0 }
              const rate = s.count > 0 ? Math.round((s.replies / s.count) * 100) : 0
              return (
                <div key={person.id} className="week-person-row">
                  <span className="week-person-name">
                    {person.name}
                    {person.id === currentPerson?.id && <span className="person-outreach-you">you</span>}
                  </span>
                  <span>{s.count}</span>
                  <span>{s.replies}</span>
                  <span style={{ color: replyRateColor(rate, s.count) }}>{rate}%</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Weekly funnel — admin only: outreach → replies → meetings → demos */}
      {isAdmin && funnel.length > 0 && (
        <FunnelCard funnel={funnel} weeks={funnelWeeks} onWeeksChange={setFunnelWeeks} />
      )}

      {/* Pipeline Overview */}
      <div className="card dashboard-card">
        <div className="dashboard-card-header">
          <h2><TrendingUp size={20} /> Pipeline</h2>
          <Link to="/pipeline" className="dashboard-link">View all →</Link>
        </div>
        <PipelineBar stats={pipelineStats} />
      </div>

      {/* Alerts — secondary, at bottom */}
      {hasAlerts ? (
        <div className="card dashboard-card dashboard-alerts">
          <h2><AlertCircle size={20} color="#ef4444" /> Action Required</h2>

          {activeStale.length > 0 && (
            <AlertSection
              tone="urgent"
              title={`${activeStale.length} Active Conversation${activeStale.length === 1 ? '' : 's'} Gone Cold`}
              leads={activeStale}
              showDays
            />
          )}

          {staleLeads.length > 0 && (
            <AlertSection
              tone="warn"
              title={`${staleLeads.length} Stale Lead${staleLeads.length === 1 ? '' : 's'}`}
              leads={staleLeads}
              limit={5}
              showDays
              showStage
            />
          )}

          {followUps.length > 0 && (
            <AlertSection
              tone="info"
              icon={<Calendar size={16} />}
              title={`${followUps.length} Follow-up${followUps.length === 1 ? '' : 's'} Due Today`}
              leads={followUps}
            />
          )}

          {needsSamples.length > 0 && (
            <AlertSection
              tone="info"
              icon={<FlaskConical size={16} />}
              title={`${needsSamples.length} Lead${needsSamples.length === 1 ? '' : 's'} Need Sample Deals`}
              leads={needsSamples}
            />
          )}
        </div>
      ) : (
        <div className="card dashboard-card dashboard-ok">
          <h2>Pipeline is Healthy</h2>
          <p>No action required. All leads are up to date.</p>
        </div>
      )}
    </div>
  )
}

// Personal gamification block. Everything here is the signed-in user's own
// numbers — no teammate data, consistent with the isolation rules.
/**
 * "My Week" — what moved, not how much was sent.
 *
 * This replaced a gamified volume card (daily goal ring, day streak, best
 * day/week, career milestone badges). Sales went deliberately low-volume and
 * high-targeting in Aug 2026, so rewarding send count was rewarding the wrong
 * behaviour. Leads advanced / replies / meetings / live conversations are the
 * four numbers that actually say whether the week went anywhere.
 *
 * `advanced` and `meetings` come from crm_lead_stage_events, which only
 * started recording at migration 040 — hence the "tracking since" note rather
 * than a delta that would imply a comparison we can't make yet.
 */
function MyWeekCard({ movement, prevMovement, touchesThisWeek }) {
  const cells = [
    { label: 'moved forward', value: movement.advanced, prev: prevMovement?.advanced, hint: 'leads that advanced a stage' },
    { label: 'replies', value: movement.replies, prev: prevMovement?.replies, hint: 'outreach marked replied' },
    { label: 'meetings', value: movement.meetings, prev: prevMovement?.meetings, hint: 'leads that reached Meeting Booked' },
    { label: 'live now', value: movement.live, prev: null, hint: 'in active conversation or meeting booked' }
  ]
  const nothingMoved = !movement.advanced && !movement.replies && !movement.meetings

  return (
    <div className="card dashboard-card">
      <div className="dashboard-card-header">
        <h2><Target size={20} /> My Week</h2>
        <span style={{ fontSize: '12px', color: '#6b7280' }}>
          {touchesThisWeek} touch{touchesThisWeek === 1 ? '' : 'es'} logged
        </span>
      </div>

      <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {cells.map(c => (
          <div key={c.label} style={{ minWidth: '110px' }} title={c.hint}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <span style={{ fontSize: '26px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: c.value > 0 ? '#111827' : '#9ca3af' }}>
                {c.value}
              </span>
              <Delta curr={c.value} prev={c.prev} />
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{c.label}</div>
          </div>
        ))}
      </div>

      {nothingMoved && (
        <div style={{ marginTop: '12px', fontSize: '13px', color: '#6b7280' }}>
          Nothing moved yet this week — replies, stage changes and meetings show up here.
        </div>
      )}
      {movement.sampleFrom && (
        <div style={{ marginTop: '10px', fontSize: '11px', color: '#9ca3af' }}>
          Stage movement tracked since {fmtDate(movement.sampleFrom)}.
        </div>
      )}
    </div>
  )
}

// Week-over-week delta chip. Positive = green for counts/rates where up is
// good (everything in this funnel).
function Delta({ curr, prev, suffix = '' }) {
  if (prev == null) return null
  const diff = curr - prev
  if (diff === 0) return <span style={{ fontSize: '11px', color: '#9ca3af' }}>—</span>
  const up = diff > 0
  return (
    <span style={{ fontSize: '11px', fontWeight: 600, color: up ? '#16a34a' : '#dc2626' }}>
      {up ? '▲' : '▼'} {Math.abs(diff)}{suffix}
    </span>
  )
}

const pct = (num, den) => den > 0 ? Math.round((num / den) * 100) : 0

// Admin-only: weekly outreach → reply → meeting funnel with WoW deltas.
// "Mtg conv" = (meetings + demos) / outreach for the week.
function FunnelCard({ funnel, weeks, onWeeksChange }) {
  const curr = funnel[funnel.length - 1]
  const prev = funnel.length > 1 ? funnel[funnel.length - 2] : null
  const newestFirst = [...funnel].reverse()
  const maxOutreach = Math.max(1, ...funnel.map(w => w.outreach))

  const tiles = [
    { label: 'Outreach', value: curr.outreach, delta: <Delta curr={curr.outreach} prev={prev?.outreach} /> },
    { label: 'Reply Rate', value: `${pct(curr.replies, curr.outreach)}%`, delta: <Delta curr={pct(curr.replies, curr.outreach)} prev={prev ? pct(prev.replies, prev.outreach) : null} suffix="pp" /> },
    { label: 'Meetings', value: curr.meetings, delta: <Delta curr={curr.meetings} prev={prev?.meetings} /> },
    { label: 'PE OS Demos', value: curr.demos, delta: <Delta curr={curr.demos} prev={prev?.demos} /> },
    { label: 'Mtg Conv', value: `${pct(curr.meetings + curr.demos, curr.outreach)}%`, delta: <Delta curr={pct(curr.meetings + curr.demos, curr.outreach)} prev={prev ? pct(prev.meetings + prev.demos, prev.outreach) : null} suffix="pp" /> }
  ]

  return (
    <div className="card dashboard-card">
      <div className="dashboard-card-header">
        <h2><TrendingUp size={20} /> Funnel</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <RangePills
            options={FUNNEL_WEEK_OPTIONS.map(n => ({ key: n, label: `${n}w` }))}
            value={weeks}
            onChange={onWeeksChange}
          />
          <span className="dashboard-date-label">last {funnel.length} weeks · this week vs last</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {tiles.map(t => (
          <div key={t.label} style={{ padding: '12px 14px', background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>{t.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '20px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{t.value}</span>
              {t.delta}
            </div>
          </div>
        ))}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <th style={{ padding: '6px 8px' }}>Week</th>
            <th style={{ padding: '6px 8px', width: '30%' }}>Outreach</th>
            <th style={{ padding: '6px 8px' }}>Replies</th>
            <th style={{ padding: '6px 8px' }}>Meetings</th>
            <th style={{ padding: '6px 8px' }}>Demos</th>
            <th style={{ padding: '6px 8px' }}>Signups</th>
            <th style={{ padding: '6px 8px' }}>Mtg Conv</th>
          </tr>
        </thead>
        <tbody>
          {newestFirst.map((w, i) => (
            <tr key={w.weekStart} style={{ borderBottom: '1px solid #f3f4f6', fontWeight: i === 0 ? 600 : 400, background: i === 0 ? '#eff6ff' : undefined }}>
              <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                {fmtDate(w.weekStart)}{i === 0 && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#1d4ed8', fontWeight: 600 }}>now</span>}
              </td>
              <td style={{ padding: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ flex: 1, height: '8px', background: '#f3f4f6', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: `${(w.outreach / maxOutreach) * 100}%`, height: '100%', background: '#60a5fa' }} />
                  </div>
                  <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: '32px', textAlign: 'right' }}>{w.outreach}</span>
                </div>
              </td>
              <td style={{ padding: '8px', fontVariantNumeric: 'tabular-nums' }}>{w.replies} <span style={{ color: '#6b7280' }}>({pct(w.replies, w.outreach)}%)</span></td>
              <td style={{ padding: '8px', fontVariantNumeric: 'tabular-nums' }}>{w.meetings}</td>
              <td style={{ padding: '8px', fontVariantNumeric: 'tabular-nums' }}>{w.demos}</td>
              <td style={{ padding: '8px', fontVariantNumeric: 'tabular-nums', color: w.signups > 0 ? '#16a34a' : undefined, fontWeight: w.signups > 0 ? 600 : undefined }}>{w.signups}</td>
              <td style={{ padding: '8px', fontVariantNumeric: 'tabular-nums' }}>{pct(w.meetings + w.demos, w.outreach)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PipelineBar({ stats }) {
  const total = useMemo(
    () => PIPELINE_SEGMENTS.reduce((sum, s) => sum + (stats[s.key] || 0), 0),
    [stats]
  )
  if (total === 0) {
    return <div className="pipeline-empty">No leads in pipeline yet</div>
  }
  return (
    <>
      <div className="pipeline-bar">
        {PIPELINE_SEGMENTS.map(seg => {
          const count = stats[seg.key] || 0
          const pct = total > 0 ? (count / total) * 100 : 0
          if (pct === 0) return null
          return (
            <div
              key={seg.key}
              className="pipeline-segment"
              style={{ width: `${pct}%`, background: seg.color }}
              title={`${seg.label}: ${count} (${Math.round(pct)}%)`}
            >
              {pct >= 12 && <span className="pipeline-segment-label">{seg.label}: {count}</span>}
              {pct < 12 && pct >= 5 && <span className="pipeline-segment-label">{count}</span>}
            </div>
          )
        })}
      </div>
      <div className="pipeline-legend">
        {PIPELINE_SEGMENTS.map(seg => (
          <div key={seg.key} className="pipeline-legend-item">
            <span className="pipeline-legend-dot" style={{ background: seg.color }} />
            <span className="pipeline-legend-label">{seg.label}</span>
            <span className="pipeline-legend-count">{stats[seg.key] || 0}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function AlertSection({ tone, title, icon, leads, limit, showDays, showStage }) {
  const shown = limit ? leads.slice(0, limit) : leads
  const overflow = limit && leads.length > limit ? leads.length - limit : 0
  return (
    <div className={`alert-section alert-section-${tone}`}>
      <h3 className="alert-section-title">
        {icon && <span className="alert-section-icon">{icon}</span>}
        {title}
      </h3>
      <ul className="alert-lead-list">
        {shown.map(lead => (
          <li key={lead.id} className="alert-lead-row">
            <Link to={`/leads/${lead.id}`} className="alert-lead-name">{lead.name}</Link>
            {lead.firm_name && <span className="alert-lead-firm">{lead.firm_name}</span>}
            {showStage && lead.stage && <StageChip stage={lead.stage} />}
            {showDays && lead.last_activity_date && (
              <span className="alert-lead-days">
                <Clock size={12} />
                {daysSince(lead.last_activity_date)}d
              </span>
            )}
          </li>
        ))}
      </ul>
      {overflow > 0 && <div className="alert-overflow">… and {overflow} more</div>}
    </div>
  )
}

export default Dashboard
