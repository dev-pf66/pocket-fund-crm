import { useState } from 'react'
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react'
import { fmtDate } from '../lib/dateUtils'

/**
 * Every call with this lead, summarised in one place, at the top of the page.
 *
 * Om's ask on the 27 Sept call, close to verbatim: "if I've had 3 calls with
 * Rafay, I can see a summarized meeting note for all 3 transcripts in one place.
 * So that's all I'd need to jog my memory up." The analysis was already being
 * rendered — but per transcript, in a section near the bottom of a 1,900-line
 * page, one expandable block at a time. You had to go looking for it, which
 * meant nobody read it before a call.
 *
 * COSTS NOTHING TO RUN. `ai_analysis` (summary, sentiment, fit_score, next_step,
 * fit_reasoning) is already computed by api/analyze-transcript.js at the moment
 * someone pastes a transcript, and stored on the row. This is a read. Dev's
 * concern about API credits on the call applies to *generating* analysis, not to
 * surfacing what has already been paid for — 26 of the 39 transcripts on file
 * already carry one.
 *
 * Honest about gaps: a transcript with no analysis is listed as unanalysed
 * rather than skipped, because a silently shorter list reads as "no call
 * happened". Generating one is a deliberate click in the Call Transcripts
 * section below — that one does cost credits, so it is never automatic.
 */

const SENTIMENT_COLOR = {
  positive: { fg: '#166534', bg: '#dcfce7', bd: '#bbf7d0' },
  neutral:  { fg: '#374151', bg: '#f3f4f6', bd: '#e5e7eb' },
  negative: { fg: '#991b1b', bg: '#fee2e2', bd: '#fecaca' },
}

function Chip({ children, tone = 'neutral' }) {
  const c = SENTIMENT_COLOR[tone] || SENTIMENT_COLOR.neutral
  return (
    <span style={{
      padding: '1px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
      color: c.fg, background: c.bg, border: `1px solid ${c.bd}`, whiteSpace: 'nowrap'
    }}>{children}</span>
  )
}

const Stars = ({ score }) => (
  <span title={`Fit ${score}/5`} style={{ letterSpacing: '1px' }}>
    {[1, 2, 3, 4, 5].map(i => (
      <span key={i} style={{ color: i <= score ? '#f59e0b' : '#d1d5db' }}>★</span>
    ))}
  </span>
)

function TranscriptDigest({ transcripts = [] }) {
  const [openAll, setOpenAll] = useState(false)
  if (!transcripts.length) return null

  // getLeadTranscripts already orders call_date desc, but this component is the
  // one thing a person reads before dialling — don't inherit an ordering
  // assumption from a query someone might reasonably change later.
  const ordered = [...transcripts].sort((a, b) =>
    String(b.call_date || '').localeCompare(String(a.call_date || '')))

  const [latest, ...earlier] = ordered
  const a = latest.ai_analysis
  const analysedCount = ordered.filter(t => t.ai_analysis).length

  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <Sparkles size={16} color="#7c3aed" />
        <strong style={{ fontSize: '14px' }}>
          {ordered.length} call{ordered.length === 1 ? '' : 's'} on record
        </strong>
        <span style={{ fontSize: '12px', color: '#6b7280' }}>
          latest {latest.call_date ? fmtDate(String(latest.call_date).slice(0, 10)) : 'undated'}
        </span>
        {a?.sentiment && <Chip tone={String(a.sentiment).toLowerCase()}>{a.sentiment}</Chip>}
        {a?.fit_score != null && <Stars score={a.fit_score} />}
      </div>

      {a?.summary ? (
        <div style={{ fontSize: '14px', lineHeight: 1.5, color: '#1f2937' }}>{a.summary}</div>
      ) : (
        <div style={{ fontSize: '13px', color: '#92400e' }}>
          The most recent call has no analysis yet — run it from Call Transcripts below.
        </div>
      )}

      {a?.next_step && (
        <div style={{ marginTop: '8px', fontSize: '13px', color: '#1f2937' }}>
          <strong>Next step:</strong> {a.next_step}
        </div>
      )}

      {earlier.length > 0 && (
        <>
          <button
            onClick={() => setOpenAll(v => !v)}
            style={{
              marginTop: '10px', display: 'inline-flex', alignItems: 'center', gap: '4px',
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: '13px', color: '#2563eb', fontWeight: 500
            }}
          >
            {openAll ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {openAll ? 'Hide' : `Show`} the {earlier.length} earlier call{earlier.length === 1 ? '' : 's'}
          </button>

          {openAll && (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {earlier.map(t => (
                <div key={t.id} style={{ borderLeft: '2px solid #e5e7eb', paddingLeft: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>
                      {t.call_date ? fmtDate(String(t.call_date).slice(0, 10)) : 'Undated'}
                    </span>
                    {t.title && <span style={{ fontSize: '12px', color: '#6b7280' }}>{t.title}</span>}
                    {t.ai_analysis?.sentiment && (
                      <Chip tone={String(t.ai_analysis.sentiment).toLowerCase()}>{t.ai_analysis.sentiment}</Chip>
                    )}
                  </div>
                  <div style={{ fontSize: '13px', color: t.ai_analysis?.summary ? '#374151' : '#92400e', marginTop: '3px' }}>
                    {t.ai_analysis?.summary || 'Not analysed yet.'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {analysedCount < ordered.length && (
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#6b7280' }}>
          {ordered.length - analysedCount} of {ordered.length} transcripts have no analysis yet.
          Generating one calls Claude, so it stays a deliberate click in Call Transcripts below.
        </div>
      )}
    </div>
  )
}

export default TranscriptDigest
