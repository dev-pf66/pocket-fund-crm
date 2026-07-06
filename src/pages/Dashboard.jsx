import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getCRMDashboardData, getOutreachStatsByPerson, getWeeklyFunnel, getCareerOutreachCount, cachePeek } from '../lib/crm-api'
import { useApp } from '../App'
import { istToday, istAddDays, fmtDate } from '../lib/dateUtils'
import { TrendingUp, AlertCircle, Calendar, Activity, Clock, FlaskConical, Flame, Trophy, Award, Target } from 'lucide-react'
import { isAdminUser } from '../lib/admin'
import { buildDailyCounts, computeMetrics, milestoneFor } from '../lib/outreachMetrics'

const DAILY_GOAL = 10
const WEEKLY_GOAL = 50
const FUNNEL_WEEKS = 8

const PIPELINE_SEGMENTS = [
  { key: 'new_lead',             label: 'New',       color: '#a78bfa' },
  { key: 'cold_outreach',        label: 'Cold',      color: '#60a5fa' },
  { key: 'responded',            label: 'Responded', color: '#06b6d4' },
  { key: 'warm_lead',            label: 'Warm',      color: '#fbbf24' },
  { key: 'active_conversation',  label: 'Active',    color: '#f97316' },
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
  // all-time count for the milestone badge.
  const [personalRows, setPersonalRows] = useState([])
  const [careerTotal, setCareerTotal] = useState(0)
  // Admin-only weekly funnel (outreach → replies → meetings → demos).
  const [funnel, setFunnel] = useState([])
  const [loading, setLoading] = useState(() => !cachePeek(cacheKey))

  useEffect(() => {
    loadData()
  }, [currentPerson?.id, isAdmin])

  async function loadData() {
    if (!currentPerson?.id) return
    try {
      const [dashboardData, rows, myRows, career, funnelRows] = await Promise.all([
        getCRMDashboardData(currentPerson.id),
        // Admins get all-team rows; non-admins only their own.
        getOutreachStatsByPerson(7, isAdmin ? null : currentPerson.id).catch(() => []),
        getOutreachStatsByPerson(90, currentPerson.id).catch(() => []),
        getCareerOutreachCount(currentPerson.id).catch(() => 0),
        isAdmin ? getWeeklyFunnel(FUNNEL_WEEKS, null).catch(() => []) : Promise.resolve([])
      ])
      setData(dashboardData)
      setOutreachRows(rows)
      setPersonalRows(myRows)
      setCareerTotal(career)
      setFunnel(funnelRows)
    } catch (error) {
      console.error('Failed to load dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const myMetrics = useMemo(
    () => computeMetrics(buildDailyCounts(personalRows), DAILY_GOAL),
    [personalRows]
  )
  const milestone = useMemo(() => milestoneFor(careerTotal), [careerTotal])

  const today = istToday()
  const weekStart = istAddDays(today, -6)

  // Compute per-person stats from raw outreach rows
  const personStats = useMemo(() => {
    const map = new Map()
    for (const r of outreachRows) {
      if (!map.has(r.logged_by)) {
        map.set(r.logged_by, { todayCount: 0, weekCount: 0, weekReplies: 0 })
      }
      const s = map.get(r.logged_by)
      s.weekCount += 1
      if (r.status === 'replied') s.weekReplies += 1
      if (r.outreach_date === today) s.todayCount += 1
    }
    return map
  }, [outreachRows, today])

  // Team totals for this week
  const teamWeek = useMemo(() => {
    let total = 0, replies = 0
    for (const s of personStats.values()) {
      total += s.weekCount
      replies += s.weekReplies
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

  const { pipelineStats, staleLeads, followUps, needsSamples, activeStale, settings } = data
  const hasAlerts = activeStale.length || staleLeads.length || followUps.length || needsSamples.length

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>Dashboard</h1>
        <Link to="/outreach" className="btn btn-primary">Log Outreach</Link>
      </div>

      {/* My Week — personal gamification, self-only data */}
      <MyWeekCard metrics={myMetrics} careerTotal={careerTotal} milestone={milestone} />

      {/* Today's Outreach */}
      <div className="card dashboard-card">
        <div className="dashboard-card-header">
          <h2><Activity size={20} /> Today's Outreach</h2>
          <span className="dashboard-date-label">{fmtDate(today)}</span>
        </div>
        <div className="today-outreach-grid">
          {visiblePeople.map(person => {
            const stats = personStats.get(person.id) || { todayCount: 0, weekCount: 0, weekReplies: 0 }
            const pct = Math.min(100, (stats.todayCount / DAILY_GOAL) * 100)
            const hit = stats.todayCount >= DAILY_GOAL
            const isMe = person.id === currentPerson?.id
            return (
              <div key={person.id} className={`person-outreach-card${isMe ? ' person-outreach-card-me' : ''}`}>
                <div className="person-outreach-name">
                  {person.name}
                  {isMe && <span className="person-outreach-you">you</span>}
                </div>
                <div className="person-outreach-count-row">
                  <span className={`person-outreach-count${hit ? ' person-outreach-count-hit' : ''}`}>
                    {stats.todayCount}
                  </span>
                  <span className="person-outreach-goal">/ {DAILY_GOAL}</span>
                </div>
                <div className="person-outreach-bar-track">
                  <div
                    className={`person-outreach-bar-fill${hit ? ' person-outreach-bar-hit' : ''}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* This Week Summary */}
      <div className="card dashboard-card">
        <div className="dashboard-card-header">
          <h2><Calendar size={20} /> {isAdmin ? 'This Week' : 'My Week'}</h2>
          <span className="dashboard-date-label">{fmtDate(weekStart)} – {fmtDate(today)}</span>
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
            <div className={`week-stat-value${teamWeek.replyRate >= 10 ? ' week-stat-good' : ''}`}>
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
              const s = personStats.get(person.id) || { weekCount: 0, weekReplies: 0 }
              const rate = s.weekCount > 0 ? Math.round((s.weekReplies / s.weekCount) * 100) : 0
              return (
                <div key={person.id} className="week-person-row">
                  <span className="week-person-name">
                    {person.name}
                    {person.id === currentPerson?.id && <span className="person-outreach-you">you</span>}
                  </span>
                  <span>{s.weekCount}</span>
                  <span>{s.weekReplies}</span>
                  <span className={rate >= 10 ? 'week-stat-good' : ''}>{rate}%</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Weekly funnel — admin only: outreach → replies → meetings → demos */}
      {isAdmin && funnel.length > 0 && <FunnelCard funnel={funnel} />}

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
function MyWeekCard({ metrics, careerTotal, milestone }) {
  const { todayCount, streak, thisWeekCount, bestDay, bestWeek } = metrics
  const ringPct = Math.min(1, todayCount / DAILY_GOAL)
  const weekPct = Math.min(100, (thisWeekCount / WEEKLY_GOAL) * 100)
  const ringHit = todayCount >= DAILY_GOAL
  const size = 76, stroke = 8
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r

  return (
    <div className="card dashboard-card">
      <div className="dashboard-card-header">
        <h2><Target size={20} /> My Week</h2>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '4px 12px', borderRadius: '999px',
          background: streak > 0 ? '#fff7ed' : '#f3f4f6',
          border: `1px solid ${streak > 0 ? '#fed7aa' : '#e5e7eb'}`,
          fontSize: '13px', fontWeight: 600,
          color: streak > 0 ? '#9a3412' : '#6b7280'
        }}>
          <Flame size={14} style={{ color: streak > 0 ? '#ea580c' : '#9ca3af' }} />
          {streak} day{streak === 1 ? '' : 's'} streak
        </span>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Today ring */}
        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
          <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
            <circle
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={ringHit ? '#16a34a' : '#2563eb'} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={`${circ * ringPct} ${circ * (1 - ringPct)}`}
              style={{ transition: 'stroke-dasharray 0.4s ease' }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '17px', fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{todayCount}</span>
            <span style={{ fontSize: '10px', color: '#6b7280' }}>/ {DAILY_GOAL} today</span>
          </div>
        </div>

        {/* Weekly progress */}
        <div style={{ flex: '1 1 220px', minWidth: '200px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              This Week
            </span>
            <span style={{ fontSize: '13px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {thisWeekCount} <span style={{ color: '#6b7280', fontWeight: 500 }}>/ {WEEKLY_GOAL}</span>
            </span>
          </div>
          <div style={{ height: '10px', background: '#e5e7eb', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{
              width: `${weekPct}%`, height: '100%',
              background: thisWeekCount >= WEEKLY_GOAL ? '#16a34a' : 'linear-gradient(90deg, #3b82f6, #2563eb)',
              transition: 'width 0.4s ease'
            }} />
          </div>
          <div style={{ display: 'flex', gap: '14px', marginTop: '8px', fontSize: '12px', color: '#6b7280', flexWrap: 'wrap' }}>
            <span><Trophy size={12} style={{ verticalAlign: '-2px' }} /> Best day: <strong style={{ color: '#111827' }}>{bestDay.count || 0}</strong>{bestDay.date ? ` (${fmtDate(bestDay.date)})` : ''}</span>
            <span>Best week: <strong style={{ color: '#111827' }}>{bestWeek.count || 0}</strong></span>
          </div>
        </div>

        {/* Career milestone */}
        <div style={{ flexShrink: 0, textAlign: 'center', padding: '10px 16px', background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: '10px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: milestone.reached?.color || '#6b7280' }}>
            <Award size={15} />
            {milestone.reached ? milestone.reached.label : 'Rookie'}
          </div>
          <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '3px', fontVariantNumeric: 'tabular-nums' }}>
            {careerTotal.toLocaleString()} all-time
            {milestone.next && <> · {milestone.toNext} to {milestone.next.label}</>}
          </div>
        </div>
      </div>
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
function FunnelCard({ funnel }) {
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
        <span className="dashboard-date-label">last {funnel.length} weeks · this week vs last</span>
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
            <tr key={w.weekStart} style={{ borderBottom: '1px solid #f3f4f6', fontWeight: i === 0 ? 600 : 400 }}>
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
            {showStage && lead.stage && (
              <span className="alert-lead-stage">{lead.stage.replace(/_/g, ' ')}</span>
            )}
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
