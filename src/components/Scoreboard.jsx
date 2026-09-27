import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getScoreboard } from '../lib/crm-api'
import { useApp } from '../App'
import { isAdminUser } from '../lib/admin'
import { STALE_BREACH_DAYS } from '../lib/leadHealth'
import { fmtDate } from '../lib/dateUtils'
import { AlertTriangle, Users as UsersIcon } from 'lucide-react'

/**
 * The per-person weekly scoreboard — what Om asked for on the 27 Sept call:
 * "somewhere we can see that these guys are actually following up".
 *
 * The three KPIs Dev named (outreach done, follow-ups, meetings booked) plus the
 * rot, because Om's point was that a lead added for follow-up and then ignored
 * "is just gonna sit in the follow-up section".
 *
 * REPLACES the old "Today's Outreach" card, which drew a progress bar against
 * each person's daily target. Targets were deliberately set to 0 in Aug 2026
 * when sales moved to low-volume/high-targeting, and every person in the
 * database has 0 or NULL — so that card rendered an empty bar and a count like
 * "8 / 0" for the one person doing the work. Targets stay supported and fluid
 * (Dev): if someone is given a real number, the target column shows it, and if
 * not there is simply no column rather than a broken meter.
 *
 * Non-admins see only their own row. Zeros are shown, never hidden — a person
 * missing from the board reads as fine, and a zero does not.
 */

const N = ({ value, warn = false, muted = false }) => (
  <td style={{
    padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
    fontWeight: warn && value > 0 ? 700 : 500,
    color: warn && value > 0 ? '#b91c1c' : muted && value === 0 ? '#9ca3af' : '#111827'
  }}>{value}</td>
)

function Scoreboard() {
  const { currentPerson, people } = useApp()
  const isAdmin = isAdminUser(currentPerson)
  const [board, setBoard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!currentPerson?.id) return
    let cancelled = false
    // `dev+localtest` is a test account. It sat in every per-person grid as a
    // permanent row of zeros, which is noise on a board whose whole job is to
    // make a row of zeros mean something.
    const roster = (people || [])
      .filter(p => !p.is_archived)
      .filter(p => !/\+localtest/.test(p.email || ''))
      .filter(p => isAdmin || p.id === currentPerson.id)

    // No setLoading(true) here: it is already true on first mount, and a
    // refetch keeps the previous board on screen rather than flashing a spinner.
    // (Also what react-hooks/set-state-in-effect wants — no synchronous setState
    // in an effect body.)
    getScoreboard({ people: roster })
      .then(b => { if (!cancelled) { setBoard(b); setError(null) } })
      .catch(e => { if (!cancelled) { console.error('Scoreboard failed:', e); setError(e) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentPerson?.id, isAdmin, people])

  if (loading && !board) return <div className="card" style={{ padding: '20px' }}>Loading scoreboard…</div>
  if (error) return (
    <div className="card" style={{ padding: '20px', color: '#b91c1c' }}>
      Could not load the scoreboard: {error.message}
    </div>
  )
  if (!board) return null

  const { rows, team, bounds, unattributedOutreach } = board

  return (
    <div className="card dashboard-card">
      <div className="dashboard-card-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
        <h2><UsersIcon size={20} /> {isAdmin ? 'This week, by person' : 'My week'}</h2>
        <span className="dashboard-date-label">{fmtDate(bounds.start)} – {fmtDate(bounds.end)}</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Person</th>
              <th style={{ textAlign: 'right', padding: '8px' }} title="Leads in their book, excluding archived">Book</th>
              <th style={{ textAlign: 'right', padding: '8px' }} title="Outreach rows logged this week — dials included">Outreach</th>
              <th style={{ textAlign: 'right', padding: '8px' }} title="Of which phone dials">Dials</th>
              {/* Two columns, never one called "Meetings". The Monday Sage digest
                  reports meetings HELD; this used to report BOOKED under the same
                  word, which is how the two came to disagree. Both are worth
                  knowing — "is work coming" vs "did work land". */}
              <th style={{ textAlign: 'right', padding: '8px' }} title="Leads moved INTO meeting_booked this week — agreed to meet, may not have happened yet">Booked</th>
              <th style={{ textAlign: 'right', padding: '8px' }} title="Meetings that actually happened — the same number the Monday Sage digest reports">Held</th>
              <th style={{ textAlign: 'right', padding: '8px' }} title="Leads with a follow-up date set for today or later">F/U set</th>
              <th style={{ textAlign: 'right', padding: '8px' }} title="Follow-ups actually marked done this week">F/U done</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#b91c1c' }}
                  title={`Leads untouched for ${STALE_BREACH_DAYS}+ days with no follow-up scheduled — a running clock, not a one-off deadline`}>
                Stale {STALE_BREACH_DAYS}d
              </th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#b91c1c' }} title="Leads missing required info for the stage they have reached">No info</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#b91c1c' }} title="Leads at meeting stage or beyond with no transcript on file">No transcript</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isMe = r.personId === currentPerson?.id
              return (
                <tr key={r.personId} style={{ borderTop: '1px solid #f3f4f6', background: isMe ? '#f8fafc' : undefined }}>
                  <td style={{ padding: '8px', fontWeight: isMe ? 600 : 500 }}>
                    {r.name || `person ${r.personId}`}
                    {isMe && <span style={{ marginLeft: 6, fontSize: '11px', color: '#6b7280' }}>you</span>}
                  </td>
                  <N value={r.liveLeads} muted />
                  <N value={r.outreachDone} />
                  <N value={r.dials} muted />
                  <N value={r.meetingsBooked} />
                  <N value={r.meetingsHeld} />
                  <N value={r.followUpsScheduled} />
                  <N value={r.followUpsDone} />
                  <N value={r.staleBreaches} warn />
                  <N value={r.missingInfo} warn />
                  <N value={r.needsTranscript} warn />
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #e5e7eb', fontWeight: 700 }}>
              <td style={{ padding: '8px' }}>Team</td>
              <N value={team.liveLeads} />
              <N value={team.outreachDone} />
              <N value={team.dials} />
              <N value={team.meetingsBooked} />
              <N value={team.meetingsHeld} />
              <N value={team.followUpsScheduled} />
              <N value={team.followUpsDone} />
              <N value={team.staleBreaches} warn />
              <N value={team.missingInfo} warn />
              <N value={team.needsTranscript} warn />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* The team row sums only the rows above it, so work with no person on it
          has to be reported separately rather than folded in or dropped. */}
      {unattributedOutreach > 0 && (
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '8px 10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <AlertTriangle size={14} />
          {unattributedOutreach} outreach row{unattributedOutreach === 1 ? '' : 's'} this week
          have no person recorded, so they are in nobody&rsquo;s count and not in the team total.
        </div>
      )}

      <div style={{ marginTop: '10px', fontSize: '12px', color: '#6b7280' }}>
        The three red columns have no week — a lead 60 days untouched is a problem today whichever
        week you are looking at. <Link to="/pipeline">Work them in the pipeline</Link>.
      </div>
    </div>
  )
}

export default Scoreboard
