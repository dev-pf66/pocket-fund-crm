import { useEffect, useState } from 'react'
import { Clock, Save } from 'lucide-react'
import { getCRMSettings, updateCRMSettings, STALENESS_SETTINGS, getLeads } from '../lib/crm-api'
import { useApp } from '../App'
import { useToast } from './Toast'

/**
 * Edit the three staleness thresholds — and show what each one currently does.
 *
 * `crm_settings` had one row written 2026-02-05, no write path and no UI. Those
 * numbers drive calculateStaleness, getStaleLeads and the Today tab's marks, and
 * on 2026-09-29 they flagged 68% of the live pipeline as stale (92% of
 * meeting_booked). A staleness colour red on two thirds of the board carries no
 * information, and nobody could change it without database access.
 *
 * THE LIVE IMPACT COLUMN IS THE POINT. A number in a box tells you nothing about
 * whether it is sensible; "flags 322 of 479 (67%)" does, and it updates as you
 * type. That is what was missing — not the ability to edit, but any way to see
 * the consequence of the value.
 */

function StalenessSettings() {
  const { currentPerson, people } = useApp()
  const { toast } = useToast()
  const [saved, setSaved] = useState(null)      // what's in the DB
  const [draft, setDraft] = useState({})        // what's in the inputs
  const [leads, setLeads] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    getCRMSettings()
      .then(s => {
        if (cancelled) return
        setSaved(s)
        setDraft(Object.fromEntries(STALENESS_SETTINGS.map(f => [f.key, s[f.key] ?? ''])))
      })
      .catch(err => console.error('Settings load failed:', err))
    // The live pipeline, for the impact column. Archived leads are excluded by
    // getLeads, which is what the staleness colours see too.
    getLeads({})
      .then(rows => { if (!cancelled) setLeads(rows) })
      .catch(err => console.error('Impact preview load failed:', err))
    return () => { cancelled = true }
  }, [])

  /** How many live leads in these stages a threshold of `days` would flag. */
  function impact(stages, days) {
    if (!leads || !Number.isFinite(Number(days))) return null
    const now = Date.now()
    const inStage = leads.filter(l => stages.includes(l.stage))
    const stale = inStage.filter(l => {
      const ref = l.last_activity_date || l.created_at
      if (!ref) return false
      return Math.floor((now - new Date(ref)) / 86400000) > Number(days)
    })
    return { total: inStage.length, stale: stale.length }
  }

  const dirty = saved && STALENESS_SETTINGS.some(f => String(draft[f.key]) !== String(saved[f.key]))

  async function handleSave() {
    setSaving(true)
    try {
      const updated = await updateCRMSettings(draft, currentPerson?.id)
      setSaved(updated)
      toast.success('Staleness thresholds updated')
    } catch (error) {
      console.error('Settings save failed:', error)
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  if (!saved) return <div className="card" style={{ padding: '20px' }}>Loading settings…</div>

  return (
    <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 600 }}>
        <Clock size={18} /> When a lead counts as stale
      </h3>
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
        These drive the staleness colours on the Pipeline board and the marks on Today.
        They had no editor until now — the values below were set in February 2026 and
        could only be changed in the database. The right-hand column shows what each
        number does to the live pipeline as you change it.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {STALENESS_SETTINGS.map(f => {
          const before = impact(f.stages, saved[f.key])
          const after = impact(f.stages, draft[f.key])
          const changed = String(draft[f.key]) !== String(saved[f.key])
          const pct = after && after.total ? Math.round(after.stale / after.total * 100) : 0
          return (
            <div key={f.key} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ minWidth: '260px', flex: '1 1 260px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#111827' }}>{f.label}</label>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>{f.hint}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  type="number" min="1" max="365"
                  className="form-input"
                  style={{ width: '84px' }}
                  value={draft[f.key]}
                  onChange={(e) => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                />
                <span style={{ fontSize: '13px', color: '#6b7280' }}>days</span>
              </div>
              <div style={{ minWidth: '210px', fontSize: '12px', color: pct > 60 ? '#b91c1c' : '#374151' }}>
                {after == null ? '—' : (
                  <>
                    flags <strong>{after.stale}</strong> of {after.total} ({pct}%)
                    {changed && before && (
                      <span style={{ color: '#6b7280' }}> · was {before.stale}</span>
                    )}
                    {pct > 60 && <div style={{ color: '#b91c1c' }}>most of this stage — the colour stops meaning anything</div>}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '18px' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={!dirty || saving}>
          <Save size={14} /> {saving ? 'Saving…' : 'Save thresholds'}
        </button>
        {dirty && <span style={{ fontSize: '12px', color: '#92400e' }}>Unsaved changes</span>}
        {/* Who, not just when (migration 057) — this row changes the colouring for
            the whole team, so "why is everything red this morning" needs an answer. */}
        <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: 'auto' }}>
          Last changed {saved.updated_at ? new Date(saved.updated_at).toLocaleDateString() : 'never'}
          {saved.updated_by
            ? ` by ${(people || []).find(p => p.id === saved.updated_by)?.name || `person ${saved.updated_by}`}`
            : ' (before this was recorded)'}
        </span>
      </div>
    </div>
  )
}

export default StalenessSettings
