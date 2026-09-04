import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getCallQueue, getCallFunnel, getCallerScorecard, getCallbacksDue,
  logCall, getTodayCallCount, setDoNotCall, getCallLog, MAX_CALL_ATTEMPTS,
  logCallTranscript, getCallTranscriptIds
} from '../lib/crm-api'
import {
  CALL_OUTCOMES, outcomeLabel, outcomeColor, fmtRate, fmtDuration, rate
} from '../lib/callOutcomes'
import { useApp } from '../App'
import { useToast } from '../components/Toast'
import { isAdminUser } from '../lib/admin'
import { dailyTargetOf, hasTarget } from './Dashboard'
import { fmtDate, istToday } from '../lib/dateUtils'
import { useSessionState } from '../hooks/useSessionState'
import {
  Phone, PhoneCall, PhoneOff, SkipForward, Clock, Copy, Mic,
  TrendingUp, Users, Ban, ExternalLink, RefreshCw, FileText, Check
} from 'lucide-react'

// Keyboard shortcuts for Call Mode. At 20 dials a day the difference between
// one keystroke and a four-field form is whether the log gets filled in at
// all — and an unfilled log is worse than no log, because it looks like data.
const OUTCOME_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

const WINDOWS = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
]

/** "2 hours ago" / "Mar 3" — deliberately coarse; exact times don't help here. */
function timeAgo(ts) {
  if (!ts) return 'never'
  const then = new Date(String(ts).length <= 10 ? `${ts}T12:00:00Z` : ts).getTime()
  if (Number.isNaN(then)) return 'never'
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`
  const days = Math.floor(mins / 1440)
  if (days < 30) return `${days}d ago`
  return fmtDate(String(ts).slice(0, 10))
}

/** datetime-local value → ISO, treating the input as the user's own clock. */
function localToIso(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function ColdCalls() {
  const { currentPerson } = useApp()
  const { toast } = useToast()
  const isAdmin = isAdminUser(currentPerson)

  const [tab, setTab] = useSessionState('cc:tab', 'call')
  const [daysBack, setDaysBack] = useSessionState('cc:window', 30)
  const [teamScope, setTeamScope] = useSessionState('cc:team', false)

  const scopeId = isAdmin && teamScope ? null : currentPerson?.id

  return (
    <div className="page-content">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <PhoneCall size={24} /> Cold Calls
          </h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0 0' }}>
            Dials count toward the daily goal. Pickups and conversations are what we manage on.
          </p>
        </div>
        {tab !== 'call' && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select className="form-select" style={{ width: 'auto' }} value={daysBack} onChange={e => setDaysBack(Number(e.target.value))}>
              {WINDOWS.map(w => <option key={w.value} value={w.value}>Last {w.label}</option>)}
            </select>
            {isAdmin && (
              <select className="form-select" style={{ width: 'auto' }} value={teamScope ? 'team' : 'me'} onChange={e => setTeamScope(e.target.value === 'team')}>
                <option value="me">Just me</option>
                <option value="team">Whole team</option>
              </select>
            )}
          </div>
        )}
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'call' ? 'active' : ''}`} onClick={() => setTab('call')}>
          <Phone size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />Call Mode
        </button>
        <button className={`tab ${tab === 'funnel' ? 'active' : ''}`} onClick={() => setTab('funnel')}>
          <TrendingUp size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />Funnel
        </button>
        <button className={`tab ${tab === 'callers' ? 'active' : ''}`} onClick={() => setTab('callers')}>
          <Users size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />Callers
        </button>
      </div>

      {tab === 'call' && <CallMode person={currentPerson} toast={toast} />}
      {tab === 'funnel' && <FunnelView daysBack={daysBack} personId={scopeId} teamScope={isAdmin && teamScope} />}
      {tab === 'callers' && <CallersView daysBack={daysBack} />}
    </div>
  )
}

// ============================================================================
// CALL MODE — the dial list
// ============================================================================

function CallMode({ person, toast }) {
  const [loading, setLoading] = useState(true)
  const [queue, setQueue] = useState([])
  const [callbacks, setCallbacks] = useState([])
  const [exhausted, setExhausted] = useState([])
  const [cursor, setCursor] = useState(0)
  const [todayCount, setTodayCount] = useState(0)
  const [todayRows, setTodayRows] = useState([])
  const [saving, setSaving] = useState(false)

  // Pending detail for the dial in progress. `outcome` set = the panel is open
  // and waiting on a confirm (only 'callback' forces this; everything else
  // logs on the first tap).
  const [pending, setPending] = useState(null)
  const [notes, setNotes] = useState('')
  const [duration, setDuration] = useState('')
  const [recordingUrl, setRecordingUrl] = useState('')
  const [callbackAt, setCallbackAt] = useState('')
  // Transcript for the dial in progress. Usually pasted after the fact, so
  // the logged-today list carries its own entry point below.
  const [transcript, setTranscript] = useState('')
  const [showTranscript, setShowTranscript] = useState(false)
  // outreach_log_id -> has a transcript. Drives the marker on logged rows.
  const [transcriptIds, setTranscriptIds] = useState(() => new Set())
  const [transcriptFor, setTranscriptFor] = useState(null)
  const [rowTranscript, setRowTranscript] = useState('')
  const [savingTranscript, setSavingTranscript] = useState(false)

  const target = dailyTargetOf(person)

  const load = useCallback(async () => {
    if (!person?.id) return
    setLoading(true)
    try {
      const [q, cbs, count, log] = await Promise.all([
        getCallQueue(person.id, { limit: 60 }),
        getCallbacksDue(person.id),
        getTodayCallCount(person.id),
        getCallLog({ daysBack: 1 }, person.id),
      ])
      setQueue(q.queue)
      setExhausted(q.exhausted)
      setCallbacks(cbs)
      setTodayCount(count)
      const todays = log.filter(r => r.outreach_date === istToday())
      setTodayRows(todays)
      setCursor(0)
      // Non-fatal: the marker is a convenience, not the queue.
      try {
        setTranscriptIds(await getCallTranscriptIds(todays.map(r => r.id)))
      } catch (e) {
        console.error('Could not load transcript markers:', e)
      }
    } catch (e) {
      console.error(e)
      toast?.(`Could not load the call queue: ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [person?.id, toast])

  useEffect(() => { load() }, [load])

  // Callbacks jump the queue: someone who already agreed to talk is the most
  // expensive contact on the page to drop.
  const workList = useMemo(() => {
    const cbLeads = callbacks
      .filter(c => c.lead)
      .map(c => ({
        ...c.lead,
        phone: c.lead.phone || c.phone_number,
        attempts: c.attempt_number || 0,
        lastOutcome: c.call_outcome,
        lastCalledAt: c.called_at,
        callbackAt: c.callback_at,
        isCallback: true,
      }))
    const seen = new Set(cbLeads.map(l => l.id))
    return [...cbLeads, ...queue.filter(l => !seen.has(l.id))]
  }, [callbacks, queue])

  const current = workList[cursor] || null

  const resetPanel = useCallback(() => {
    setPending(null)
    setNotes('')
    setDuration('')
    setRecordingUrl('')
    setCallbackAt('')
    setTranscript('')
    setShowTranscript(false)
  }, [])

  const advance = useCallback(() => {
    resetPanel()
    setCursor(c => c + 1)
  }, [resetPanel])

  const saveRowTranscript = useCallback(async (row) => {
    if (!rowTranscript.trim() || savingTranscript) return
    setSavingTranscript(true)
    try {
      await logCallTranscript({
        leadId: row.lead_id,
        outreachLogId: row.id,
        transcript: rowTranscript,
        title: `Cold call — ${row.lead_name || row.phone_number || 'unknown contact'}`,
        calledAt: row.called_at,
        currentPersonId: person?.id,
      })
      setTranscriptIds(prev => new Set(prev).add(row.id))
      setTranscriptFor(null)
      setRowTranscript('')
      toast?.('Transcript saved', 'success')
    } catch (e) {
      console.error(e)
      toast?.(`Could not save the transcript: ${e.message}`, 'error')
    } finally {
      setSavingTranscript(false)
    }
  }, [rowTranscript, savingTranscript, person?.id, toast])

  const submit = useCallback(async (outcome, extra = {}) => {
    if (!current || !person?.id || saving) return
    setSaving(true)
    try {
      const seconds = duration.trim() === '' ? null : Math.round(Number(duration) * 60)
      const saved = await logCall({
        lead_id: current.id,
        lead_name: current.name,
        firm_name: current.firm_name,
        phone_number: current.phone,
        call_outcome: outcome,
        call_duration_seconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : null,
        notes: notes.trim() || null,
        recording_url: recordingUrl.trim() || null,
        ...extra,
      }, person.id, person.name)

      setTodayCount(c => c + 1)
      setTodayRows(rows => [{ ...saved, lead_name: current.name, firm_name: current.firm_name }, ...rows])

      // The dial is already counted. A transcript that fails to save must not
      // take the dial down with it — say so and leave the call logged.
      if (transcript.trim()) {
        try {
          await logCallTranscript({
            leadId: current.id,
            outreachLogId: saved?.id ?? null,
            transcript,
            title: `Cold call — ${current.name}`,
            calledAt: saved?.called_at,
            currentPersonId: person.id,
          })
          if (saved?.id) setTranscriptIds(prev => new Set(prev).add(saved.id))
        } catch (e) {
          console.error(e)
          toast?.(`Call logged, but the transcript did not save: ${e.message}`, 'error')
        }
      }

      toast?.(`${current.name} — ${outcomeLabel(outcome)}`, outcome === 'meeting_booked' ? 'success' : 'info')
      advance()
    } catch (e) {
      console.error(e)
      toast?.(`Could not log the call: ${e.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }, [current, person, saving, duration, notes, recordingUrl, transcript, toast, advance])

  const pickOutcome = useCallback((outcome) => {
    // A callback without a time is just a note nobody will read. Everything
    // else logs on the first tap — that's the whole point of Call Mode.
    if (outcome === 'callback') {
      setPending(outcome)
      return
    }
    submit(outcome)
  }, [submit])

  // Keyboard-first: 1-0 for outcomes, s to skip. Suspended while a text field
  // has focus so typing notes doesn't fire off a dial log.
  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!current || saving) return
      if (e.key === 's') { e.preventDefault(); advance(); return }
      const idx = OUTCOME_KEYS.indexOf(e.key)
      if (idx >= 0 && idx < CALL_OUTCOMES.length) {
        e.preventDefault()
        pickOutcome(CALL_OUTCOMES[idx].value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, saving, pickOutcome, advance])

  const todaySummary = useMemo(() => {
    const pickups = todayRows.filter(r => r.connected).length
    const convos = todayRows.filter(r => ['not_interested', 'callback', 'interested', 'meeting_booked', 'do_not_call'].includes(r.call_outcome)).length
    const meetings = todayRows.filter(r => r.call_outcome === 'meeting_booked').length
    return { pickups, convos, meetings }
  }, [todayRows])

  if (loading) return <div className="loading"><div className="spinner" /> Loading the call queue…</div>

  return (
    <div>
      {/* Today's numbers. Dials first because that's the goal, but pickups and
          conversations sit right next to it so volume never reads as success. */}
      <div className="stats-grid" style={{ marginBottom: '20px' }}>
        <StatCard label="Dials today" value={todayCount} sub={hasTarget(person) ? `of ${target} target` : 'no target set'} />
        <StatCard label="Pickups" value={todaySummary.pickups} sub={fmtRate(rate(todaySummary.pickups, todayCount))} />
        <StatCard label="Conversations" value={todaySummary.convos} sub="reached the person" accent="#0ea5e9" />
        <StatCard label="Meetings booked" value={todaySummary.meetings} sub="today" accent="#15803d" />
      </div>

      {callbacks.length > 0 && (
        <div className="card" style={{ marginBottom: '16px', borderLeft: '4px solid #0ea5e9' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <Clock size={16} /> {callbacks.length} callback{callbacks.length === 1 ? '' : 's'} due — these are at the front of the queue
          </div>
        </div>
      )}

      {!current ? (
        <div className="empty-state" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <Phone size={40} style={{ opacity: 0.3 }} />
          <h3 style={{ margin: '12px 0 4px' }}>
            {workList.length === 0 ? 'Nothing to call' : 'Queue cleared'}
          </h3>
          <p style={{ color: '#6b7280', maxWidth: '460px', margin: '0 auto 16px' }}>
            {workList.length === 0
              ? 'No leads assigned to you have a phone number on them. Add numbers on the Pipeline, or ask an admin to assign you leads.'
              : `You worked through all ${workList.length}. ${exhausted.length > 0 ? `${exhausted.length} more are past ${MAX_CALL_ATTEMPTS} attempts.` : ''}`}
          </p>
          <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /> Reload queue</button>
        </div>
      ) : (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              {current.isCallback && (
                <span className="badge" style={{ background: '#0ea5e9', color: 'white', marginBottom: '8px', display: 'inline-block' }}>
                  Callback due {timeAgo(current.callbackAt)}
                </span>
              )}
              <h2 style={{ margin: '0 0 2px' }}>{current.name}</h2>
              <div style={{ color: '#6b7280' }}>
                {current.firm_name || 'No firm'}{current.lead_type ? ` · ${current.lead_type}` : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '13px', color: '#6b7280' }}>
                {cursor + 1} of {workList.length} in queue
              </div>
              <div style={{ fontSize: '13px', color: '#6b7280' }}>
                Attempt {(current.attempts || 0) + 1}
                {current.lastOutcome && <> · last: {outcomeLabel(current.lastOutcome)} {timeAgo(current.lastCalledAt)}</>}
              </div>
            </div>
          </div>

          {/* The number, big, with a one-click dial. CallHippo registers as the
              tel: handler on the desktop app; Copy is the fallback for the
              web dialer. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '18px 0', flexWrap: 'wrap' }}>
            <a
              href={`tel:${String(current.phone || '').replace(/\s/g, '')}`}
              className="btn btn-primary"
              style={{ fontSize: '20px', padding: '12px 22px', textDecoration: 'none' }}
            >
              <Phone size={20} /> {current.phone}
            </a>
            <button
              className="btn btn-secondary"
              onClick={() => {
                navigator.clipboard?.writeText(String(current.phone || ''))
                toast?.('Number copied', 'info')
              }}
            >
              <Copy size={14} /> Copy
            </button>
            <a className="btn btn-secondary" href={`/leads/${current.id}`} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Open lead
            </a>
            <button
              className="btn btn-secondary"
              style={{ marginLeft: 'auto' }}
              onClick={async () => {
                await setDoNotCall(current.id, true)
                toast?.(`${current.name} marked do-not-call`, 'info')
                advance()
              }}
            >
              <Ban size={14} /> Do not call
            </button>
          </div>

          {(current.follow_up_note || current.notes) && (
            <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '10px 12px', marginBottom: '16px', fontSize: '14px' }}>
              <strong>Context:</strong> {current.follow_up_note || current.notes}
            </div>
          )}

          {/* One tap per outcome. Numbered so the keyboard path is discoverable. */}
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#6b7280', marginBottom: '8px' }}>
            How did it go? <span style={{ fontWeight: 400 }}>(press the number, or S to skip)</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '8px' }}>
            {CALL_OUTCOMES.map((o, i) => (
              <button
                key={o.value}
                className="btn"
                disabled={saving}
                title={o.hint}
                onClick={() => pickOutcome(o.value)}
                style={{
                  justifyContent: 'flex-start',
                  border: `1px solid ${o.color}`,
                  background: pending === o.value ? o.color : 'white',
                  color: pending === o.value ? 'white' : o.color,
                  fontWeight: 600,
                }}
              >
                <span style={{ opacity: 0.6, marginRight: 6, fontVariantNumeric: 'tabular-nums' }}>{OUTCOME_KEYS[i]}</span>
                {o.label}
              </button>
            ))}
          </div>

          {pending === 'callback' && (
            <div className="card" style={{ marginTop: '14px', background: '#f0f9ff' }}>
              <div className="form-group">
                <label className="form-label">When should we call back?</label>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={callbackAt}
                  onChange={e => setCallbackAt(e.target.value)}
                  autoFocus
                />
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                  Also sets the lead&apos;s next follow-up date, so it surfaces on Today.
                </div>
              </div>
              <div className="form-actions">
                <button className="btn btn-secondary" onClick={resetPanel}>Cancel</button>
                <button
                  className="btn btn-primary"
                  disabled={!callbackAt || saving}
                  onClick={() => submit('callback', { callback_at: localToIso(callbackAt) })}
                >
                  Log callback
                </button>
              </div>
            </div>
          )}

          {/* Optional detail. Left collapsed-by-default in spirit: empty fields
              cost nothing and never block the one-tap path. */}
          <div className="form-row" style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: '110px 1fr 1fr', gap: '10px' }}>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '12px' }}>Minutes</label>
              <input className="form-input" type="number" min="0" step="0.5" value={duration} onChange={e => setDuration(e.target.value)} placeholder="0" />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '12px' }}>Notes</label>
              <input className="form-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="What they said" />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '12px' }}>
                <Mic size={11} style={{ verticalAlign: '-1px' }} /> Recording URL
              </label>
              <input className="form-input" value={recordingUrl} onChange={e => setRecordingUrl(e.target.value)} placeholder="Paste the CallHippo link" />
            </div>
          </div>

          {/* Transcript. Collapsed by default — Call Mode's whole point is one
              tap per dial, and a textarea in the default path would slow every
              call to capture something you only have for a few of them. */}
          {!showTranscript ? (
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: '10px' }}
              onClick={() => setShowTranscript(true)}
            >
              <FileText size={14} /> Add transcript
            </button>
          ) : (
            <div className="form-group" style={{ marginTop: '12px' }}>
              <label className="form-label" style={{ fontSize: '12px' }}>
                <FileText size={11} style={{ verticalAlign: '-1px' }} /> Transcript
              </label>
              <textarea
                className="form-input"
                rows={6}
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
                placeholder="Paste the call transcript — it saves with the outcome you tap next"
                style={{ fontFamily: 'inherit', resize: 'vertical' }}
              />
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                Saved against this specific dial, not just the lead. You can also add one
                afterwards from the list below.
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px' }}>
            <button className="btn btn-secondary" onClick={advance} disabled={saving}>
              <SkipForward size={14} /> Skip for now
            </button>
            {saving && <span style={{ color: '#6b7280', fontSize: '13px' }}>Saving…</span>}
          </div>
        </div>
      )}

      {todayRows.length > 0 && (
        <div className="card" style={{ marginTop: '20px' }}>
          <div className="card-header"><h3 style={{ margin: 0 }}>Logged today</h3></div>
          <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
            {todayRows.map(r => (
              <div key={r.id} style={{ borderBottom: '1px solid #f3f4f6', padding: '7px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px' }}>
                  <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: outcomeColor(r.call_outcome), flexShrink: 0 }} />
                  <span style={{ fontWeight: 500 }}>{r.lead_name || r.phone_number || 'Unknown'}</span>
                  <span style={{ color: '#6b7280' }}>{r.firm_name}</span>
                  <span style={{ marginLeft: 'auto', color: outcomeColor(r.call_outcome), fontWeight: 500 }}>
                    {outcomeLabel(r.call_outcome)}
                  </span>
                  {r.call_duration_seconds > 0 && (
                    <span style={{ color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{fmtDuration(r.call_duration_seconds)}</span>
                  )}
                  {transcriptIds.has(r.id) ? (
                    <span style={{ color: '#16a34a', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                      <Check size={13} /> transcript
                    </span>
                  ) : r.lead_id ? (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setTranscriptFor(r.id); setRowTranscript('') }}
                      title="Paste the transcript for this call"
                    >
                      <FileText size={13} /> Transcript
                    </button>
                  ) : null}
                </div>

                {transcriptFor === r.id && (
                  <div style={{ marginTop: '8px' }}>
                    <textarea
                      className="form-input"
                      rows={6}
                      value={rowTranscript}
                      onChange={e => setRowTranscript(e.target.value)}
                      placeholder={`Paste the transcript of the call with ${r.lead_name || 'this contact'}`}
                      style={{ fontFamily: 'inherit', resize: 'vertical' }}
                      autoFocus
                    />
                    <div className="form-actions" style={{ marginTop: '6px' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setTranscriptFor(null)}>
                        Cancel
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={!rowTranscript.trim() || savingTranscript}
                        onClick={() => saveRowTranscript(r)}
                      >
                        {savingTranscript ? 'Saving…' : 'Save transcript'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// FUNNEL — how strong, how effective
// ============================================================================

function FunnelView({ daysBack, personId, teamScope }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const d = await getCallFunnel({ daysBack, personId })
        if (alive) setData(d)
      } catch (e) {
        if (alive) setError(e.message)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [daysBack, personId])

  if (loading) return <div className="loading"><div className="spinner" /> Crunching the funnel…</div>
  if (error) return <div className="alert-banner alert-danger">Could not load the funnel: {error}</div>
  if (!data || data.dials === 0) {
    return (
      <div className="empty-state" style={{ textAlign: 'center', padding: '48px 24px' }}>
        <PhoneOff size={40} style={{ opacity: 0.3 }} />
        <h3 style={{ margin: '12px 0 4px' }}>No calls logged in this window</h3>
        <p style={{ color: '#6b7280' }}>
          Log some dials in Call Mode and the funnel fills in from there.
        </p>
      </div>
    )
  }

  // Each level's bar is drawn against the top of the funnel, so the drop-off
  // is visible as width rather than having to be read off the percentages.
  const levels = [
    { key: 'dials', label: 'Dials', value: data.dials, rateLabel: null, color: '#94a3b8', note: 'every call placed' },
    { key: 'pickups', label: 'Pickups', value: data.pickups, rateLabel: fmtRate(data.pickupRate), color: '#f59e0b', note: 'a human answered' },
    { key: 'conversations', label: 'Conversations', value: data.conversations, rateLabel: fmtRate(data.conversationRate), color: '#0ea5e9', note: 'reached the actual person' },
    { key: 'positive', label: 'Interested', value: data.positive, rateLabel: fmtRate(data.positiveRate), color: '#16a34a', note: 'wants to keep talking' },
    { key: 'meetings', label: 'Meetings booked', value: data.meetings, rateLabel: fmtRate(data.meetingRate), color: '#15803d', note: 'on the calendar' },
  ]

  const peakHours = [...data.byHour]
    .filter(h => h.dials >= 5)
    .sort((a, b) => (b.pickupRate ?? -1) - (a.pickupRate ?? -1))
    .slice(0, 3)

  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: '20px' }}>
        <StatCard label="Dials per meeting" value={data.dialsPerMeeting ? Math.round(data.dialsPerMeeting) : '—'} sub={data.meetings === 0 ? 'no meetings yet' : 'the channel’s unit cost'} />
        <StatCard label="Pickup rate" value={fmtRate(data.pickupRate, 1)} sub={`${data.pickups} of ${data.dials}`} accent="#f59e0b" />
        <StatCard label="Conversation rate" value={fmtRate(data.conversationRate, 1)} sub="of pickups reached the person" accent="#0ea5e9" />
        <StatCard label="Avg talk time" value={fmtDuration(data.avgTalkSeconds)} sub="on connected calls" />
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-header">
          <h3 style={{ margin: 0 }}>The funnel {teamScope ? '— whole team' : ''}</h3>
          <span style={{ color: '#6b7280', fontSize: '13px' }}>last {daysBack} days</span>
        </div>
        {levels.map(l => (
          <div key={l.key} style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '4px' }}>
              <span><strong>{l.label}</strong> <span style={{ color: '#9ca3af' }}>· {l.note}</span></span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                <strong>{l.value}</strong>
                {l.rateLabel && <span style={{ color: '#6b7280' }}> · {l.rateLabel} of the level above</span>}
              </span>
            </div>
            <div style={{ background: '#f3f4f6', borderRadius: '6px', height: '22px', overflow: 'hidden' }}>
              <div style={{
                width: `${data.dials ? (l.value / data.dials) * 100 : 0}%`,
                background: l.color, height: '100%', minWidth: l.value > 0 ? '3px' : 0,
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
        <div className="card">
          <div className="card-header"><h3 style={{ margin: 0 }}>What actually happened</h3></div>
          {data.outcomeRows.map(r => (
            <div key={r.outcome || 'none'} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: outcomeColor(r.outcome), flexShrink: 0 }} />
              <span style={{ fontSize: '14px', minWidth: '120px' }}>{r.outcome ? outcomeLabel(r.outcome) : 'Not recorded'}</span>
              <div style={{ flex: 1, background: '#f3f4f6', borderRadius: '4px', height: '10px' }}>
                <div style={{ width: `${r.share || 0}%`, background: outcomeColor(r.outcome), height: '100%', borderRadius: '4px' }} />
              </div>
              <span style={{ fontSize: '13px', color: '#6b7280', minWidth: '64px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.count} · {fmtRate(r.share)}
              </span>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-header">
            <h3 style={{ margin: 0 }}>When they pick up</h3>
            <span style={{ color: '#6b7280', fontSize: '12px' }}>IST hour</span>
          </div>
          {data.byHour.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: '14px' }}>No call times recorded yet.</p>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '110px', marginBottom: '8px' }}>
                {data.byHour.map(h => {
                  const maxDials = Math.max(...data.byHour.map(x => x.dials), 1)
                  return (
                    <div key={h.hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}
                      title={`${h.hour}:00 IST — ${h.dials} dials, ${h.pickups} pickups (${fmtRate(h.pickupRate)})`}>
                      <div style={{ width: '100%', background: '#e5e7eb', height: `${(h.dials / maxDials) * 100}%`, borderRadius: '2px 2px 0 0', position: 'relative' }}>
                        <div style={{ position: 'absolute', bottom: 0, width: '100%', background: '#f59e0b', height: `${h.dials ? (h.pickups / h.dials) * 100 : 0}%`, borderRadius: '2px 2px 0 0' }} />
                      </div>
                      <span style={{ fontSize: '9px', color: '#9ca3af', marginTop: '2px' }}>{h.hour}</span>
                    </div>
                  )
                })}
              </div>
              {peakHours.length > 0 && (
                <p style={{ fontSize: '13px', color: '#374151', margin: 0 }}>
                  Best window: {peakHours.map(h => `${h.hour}:00 (${fmtRate(h.pickupRate)})`).join(', ')}
                  <span style={{ color: '#9ca3af' }}> — hours with at least 5 dials</span>
                </p>
              )}
            </>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3 style={{ margin: 0 }}>Is the 5th dial worth it?</h3>
          </div>
          <table style={{ width: '100%', fontSize: '14px' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280', fontSize: '12px' }}>
                <th style={{ padding: '4px 0' }}>Attempt</th>
                <th style={{ textAlign: 'right' }}>Dials</th>
                <th style={{ textAlign: 'right' }}>Pickups</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.attempts.map(a => (
                <tr key={a.attempt} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '5px 0' }}>{a.label}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a.dials}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a.pickups}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtRate(a.pickupRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: '12px', color: '#9ca3af', margin: '8px 0 0' }}>
            The queue stops offering a lead after {MAX_CALL_ATTEMPTS} attempts. If the rate holds up here, raise it.
          </p>
        </div>

        <div className="card">
          <div className="card-header"><h3 style={{ margin: 0 }}>Daily volume</h3></div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '110px' }}>
            {data.daily.map(d => {
              const maxDials = Math.max(...data.daily.map(x => x.dials), 1)
              return (
                <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
                  title={`${d.date}: ${d.dials} dials, ${d.pickups} pickups, ${d.conversations} conversations`}>
                  <div style={{ background: '#e5e7eb', height: `${(d.dials / maxDials) * 100}%`, borderRadius: '2px 2px 0 0', position: 'relative', minHeight: '2px' }}>
                    <div style={{ position: 'absolute', bottom: 0, width: '100%', background: '#0ea5e9', height: `${d.dials ? (d.conversations / d.dials) * 100 : 0}%`, borderRadius: '2px 2px 0 0' }} />
                  </div>
                </div>
              )
            })}
          </div>
          <p style={{ fontSize: '12px', color: '#9ca3af', margin: '8px 0 0' }}>
            Grey = dials, blue = conversations. {data.daily.length} day{data.daily.length === 1 ? '' : 's'} with activity.
          </p>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// CALLERS — consistent? effective?
// ============================================================================

function CallersView({ daysBack }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const d = await getCallerScorecard({ daysBack })
        if (alive) setRows(d)
      } catch (e) {
        if (alive) setError(e.message)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [daysBack])

  if (loading) return <div className="loading"><div className="spinner" /> Loading the scorecard…</div>
  if (error) return <div className="alert-banner alert-danger">Could not load the scorecard: {error}</div>
  if (rows.length === 0) {
    return (
      <div className="empty-state" style={{ textAlign: 'center', padding: '48px 24px' }}>
        <Users size={40} style={{ opacity: 0.3 }} />
        <h3 style={{ margin: '12px 0 4px' }}>Nobody has logged a call in this window</h3>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3 style={{ margin: 0 }}>Consistency and effectiveness</h3>
        <span style={{ color: '#6b7280', fontSize: '13px' }}>
          last {daysBack} days · sorted by conversations, not dials
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'right', color: '#6b7280', fontSize: '12px', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Caller</th>
              <th style={{ padding: '8px 6px' }} title="Days they logged at least one dial, over weekdays in the window">Days on</th>
              <th style={{ padding: '8px 6px' }}>Consistency</th>
              <th style={{ padding: '8px 6px' }}>Dials</th>
              <th style={{ padding: '8px 6px' }}>Per day</th>
              <th style={{ padding: '8px 6px' }}>Pickups</th>
              <th style={{ padding: '8px 6px' }}>Convos</th>
              <th style={{ padding: '8px 6px' }}>Meetings</th>
              <th style={{ padding: '8px 6px' }} title="Dials it took to buy one meeting">Cost</th>
              <th style={{ padding: '8px 6px' }}>Talk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.personId} style={{ borderBottom: '1px solid #f3f4f6', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                <td style={{ textAlign: 'left', padding: '9px 6px', fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: '9px 6px' }}>{r.activeDays}<span style={{ color: '#9ca3af' }}>/{r.expectedDays}</span></td>
                <td style={{ padding: '9px 6px', fontWeight: 600, color: consistencyColor(r.consistency) }}>{fmtRate(r.consistency)}</td>
                <td style={{ padding: '9px 6px' }}>{r.dials}</td>
                <td style={{ padding: '9px 6px' }}>{r.dialsPerActiveDay ? r.dialsPerActiveDay.toFixed(1) : '—'}</td>
                <td style={{ padding: '9px 6px' }}>{r.pickups} <span style={{ color: '#9ca3af' }}>{fmtRate(r.pickupRate)}</span></td>
                <td style={{ padding: '9px 6px', fontWeight: 600, color: '#0369a1' }}>{r.conversations} <span style={{ color: '#9ca3af', fontWeight: 400 }}>{fmtRate(r.conversationRate)}</span></td>
                <td style={{ padding: '9px 6px', fontWeight: 600, color: r.meetings > 0 ? '#15803d' : '#9ca3af' }}>{r.meetings}</td>
                <td style={{ padding: '9px 6px' }}>{r.dialsPerMeeting ? Math.round(r.dialsPerMeeting) : '—'}</td>
                <td style={{ padding: '9px 6px', color: '#6b7280' }}>{fmtDuration(r.avgTalkSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: '12px', color: '#9ca3af', margin: '12px 0 0' }}>
        Consistency is days with at least one dial, over weekdays in the window — nobody is expected to
        cold call on a Sunday. &ldquo;Cost&rdquo; is dials per meeting booked: high dials with a high cost is a
        script problem, low dials with a low cost is a volume problem.
      </p>
    </div>
  )
}

function consistencyColor(pct) {
  if (pct == null) return '#6b7280'
  if (pct >= 70) return '#16a34a'
  if (pct >= 40) return '#f59e0b'
  return '#dc2626'
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div className="stat-target" style={{ color: '#6b7280', fontSize: '12px' }}>{sub}</div>}
    </div>
  )
}

export default ColdCalls
