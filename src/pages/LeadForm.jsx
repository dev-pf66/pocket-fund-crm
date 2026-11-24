import { useState, useEffect, useRef } from 'react'
import { createLead, updateLead, previewLinkedInEnrichment, findDuplicateLead, getTags, getTagsByLead, addTagToLeads, createTag, removeTagFromLead } from '../lib/crm-api'
import { isLinkedInUrl, nameFromLinkedInUrl } from '../lib/linkedin'
import { Link } from 'react-router-dom'
import { useApp } from '../App'
import { useToast } from '../components/Toast'
import { useSessionState } from '../hooks/useSessionState'
import { useLeadTypes } from '../hooks/useLeadTypes'
import { Sparkles, AlertTriangle, ExternalLink, X, Plus } from 'lucide-react'

const DUPLICATE_MATCH_LABELS = {
  linkedin_url: 'the same LinkedIn profile',
  email: 'the same email address',
  name_firm: 'the same name and firm'
}

function formFrom(lead) {
  return {
    name: lead?.name || '',
    firm_name: lead?.firm_name || '',
    email: lead?.email || '',
    phone: lead?.phone || '',
    linkedin_url: lead?.linkedin_url || '',
    lead_type: lead?.lead_type || '',
    outreach_stage: lead?.outreach_stage || '',
    deal_criteria: lead?.deal_criteria || '',
    stage: lead?.stage || 'outreach',
    lead_source: lead?.lead_source || '',
    notes: lead?.notes || '',
    location: lead?.location || '',
    fit_score: lead?.fit_score != null ? String(lead.fit_score) : '',
    first_contact_date: lead?.first_contact_date || '',
    message_content: lead?.message_content || ''
  }
}

function LeadForm({ onClose, onSave, lead = null }) {
  const { currentPerson } = useApp()
  const { toast } = useToast()
  const leadTypes = useLeadTypes()
  const [loading, setLoading] = useState(false)
  const [autoFilling, setAutoFilling] = useState(false)
  // A lead already on file matching what's being typed. A warning, not a block —
  // the form is the deliberate path, so it tells you and lets you decide.
  const [duplicate, setDuplicate] = useState(null)
  const [allTags, setAllTags] = useState([])
  const [leadTags, setLeadTags] = useState([])
  const [tagSelectVal, setTagSelectVal] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const [tagBusy, setTagBusy] = useState(false)

  useEffect(() => {
    if (!lead?.id) return
    Promise.all([getTags(), getTagsByLead()]).then(([all, byLead]) => {
      setAllTags(all)
      setLeadTags(byLead.get(lead.id) || [])
    }).catch(() => {})
  }, [lead?.id])

  async function handleAddTag() {
    const id = parseInt(tagSelectVal, 10)
    if (!id || !lead?.id) return
    if (leadTags.some(t => t.id === id)) { setTagSelectVal(''); return }
    setTagBusy(true)
    try {
      await addTagToLeads([lead.id], id)
      const tag = allTags.find(t => t.id === id)
      if (tag) setLeadTags(prev => [...prev, tag])
      setTagSelectVal('')
    } catch { toast.error('Failed to add tag') }
    finally { setTagBusy(false) }
  }

  async function handleCreateTag() {
    const name = newTagName.trim()
    if (!name || !lead?.id) return
    setTagBusy(true)
    try {
      const tag = await createTag(name)
      setAllTags(prev => prev.some(t => t.id === tag.id) ? prev : [...prev, tag])
      if (!leadTags.some(t => t.id === tag.id)) {
        await addTagToLeads([lead.id], tag.id)
        setLeadTags(prev => [...prev, tag])
      }
      setNewTagName('')
    } catch { toast.error('Failed to create tag') }
    finally { setTagBusy(false) }
  }

  async function handleRemoveTag(tagId) {
    if (!lead?.id) return
    setTagBusy(true)
    try {
      await removeTagFromLead(lead.id, tagId)
      setLeadTags(prev => prev.filter(t => t.id !== tagId))
    } catch { toast.error('Failed to remove tag') }
    finally { setTagBusy(false) }
  }

  const initialForm = formFrom(lead)
  // Only the NEW-lead draft persists across navigation. Edit mode used to
  // persist too (key `lf:edit:<id>`), which meant a popup left by any route
  // other than Cancel came back next time pre-filled with the OLD values — and
  // saving would then write that stale stage/notes over whatever had changed
  // since. Edit mode is the Pipeline card's click target now (Nov 2026), so it
  // is plain component state, seeded fresh from the lead on every open.
  const [newDraft, setNewDraft, clearNewDraft] = useSessionState('lf:new', formFrom(null))
  const [editDraft, setEditDraft] = useState(initialForm)
  const formData = lead ? editDraft : newDraft
  const setFormData = lead ? setEditDraft : setNewDraft
  const clearFormData = lead ? () => {} : clearNewDraft

  // Unsaved edits in the popup are not persisted, so a stray overlay click,
  // Escape or "Open full page" asks before throwing them away.
  const isDirty = !!lead && Object.keys(initialForm).some(k => editDraft[k] !== initialForm[k])
  function close() {
    if (isDirty && !window.confirm('Discard your unsaved changes to this lead?')) return false
    onClose()
    return true
  }
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    function onKey(e) {
      // A native select/autocomplete eats its own Escape; only close when the
      // keypress reached us unhandled.
      if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function handleChange(e) {
    const { name, value } = e.target
    setFormData(prev => {
      const next = { ...prev, [name]: value }
      // When pasting a LinkedIn URL and name is empty, pre-populate the name
      // from the slug so the user doesn't have to retype it. Returns '' for a
      // run-together slug it can't split, in which case we leave the field
      // blank for the user rather than filing them as "Liroyhaddad".
      if (name === 'linkedin_url' && !prev.name.trim() && isLinkedInUrl(value)) {
        const guessed = nameFromLinkedInUrl(value)
        if (guessed) next.name = guessed
      }
      return next
    })
  }

  // Runs on blur of the fields that identify a person. Edit mode skips it:
  // a lead always matches itself.
  async function checkForDuplicate() {
    if (lead?.id) return
    const { linkedin_url, email, name, firm_name } = formData
    if (!linkedin_url.trim() && !email.trim() && !name.trim()) {
      setDuplicate(null)
      return
    }
    const match = await findDuplicateLead({ linkedin_url, email, name, firm_name })
    setDuplicate(match)
  }

  async function handleAutoFill() {
    if (!formData.linkedin_url.trim()) {
      toast.warn('Paste a LinkedIn URL first')
      return
    }
    if (!isLinkedInUrl(formData.linkedin_url)) {
      toast.warn('That doesn\'t look like a LinkedIn URL')
      return
    }

    setAutoFilling(true)
    try {
      const enrichment = await previewLinkedInEnrichment(formData.linkedin_url, {
        name: formData.name,
        firm_name: formData.firm_name,
        lead_type: formData.lead_type
      })
      // Only fill empty fields — don't clobber what the user already typed.
      setFormData(prev => ({
        ...prev,
        name: prev.name.trim() || enrichment.suggested_name || prev.name,
        lead_type: prev.lead_type || enrichment.suggested_lead_type || prev.lead_type,
        notes: prev.notes.trim() ? prev.notes : (enrichment.enrichment_notes || prev.notes)
      }))
      // Nothing on file is a real answer, not a success. Saying "auto-filled"
      // when nothing was filled is how people stopped trusting this button.
      if (enrichment.insufficient_context) {
        toast.warn('Nothing on file for this lead yet — add a firm or notes and try again')
      } else {
        toast.success('Summarised from what the CRM already knows')
      }
    } catch (error) {
      console.error('Auto-fill failed:', error)
      toast.error('Auto-fill failed: ' + error.message)
    } finally {
      setAutoFilling(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (!formData.name.trim()) {
      toast.warn('Name is required')
      return
    }
    if (!currentPerson?.id) {
      toast.error('Please wait — loading user info')
      return
    }

    setLoading(true)
    try {
      // outreach_stage has a DB CHECK constraint that only allows specific
      // values or NULL — the "Not set" option sends '' which violates it.
      // Coerce empty string to null so the row inserts cleanly.
      const payload = {
        ...formData,
        outreach_stage: formData.outreach_stage || null,
        fit_score: formData.fit_score ? parseInt(formData.fit_score, 10) : null
      }
      let saved
      if (lead?.id) {
        // Send only what changed. Writing all eleven fields back would turn
        // NULLs into '' (lead_source, lead_type…) and overwrite edits made
        // elsewhere since the board loaded.
        // A field cleared in the popup is written as NULL, not '' — "is it
        // missing" filters look for NULL.
        const changed = {}
        for (const k of Object.keys(formData)) {
          if (formData[k] !== initialForm[k]) {
            if (formData[k] === '') {
              changed[k] = null
            } else if (k === 'fit_score') {
              changed[k] = parseInt(formData[k], 10)
            } else {
              changed[k] = formData[k]
            }
          }
        }
        saved = Object.keys(changed).length
          ? await updateLead(lead.id, changed, currentPerson.id)
          : lead
      } else {
        saved = await createLead(payload, currentPerson.id)
      }
      clearFormData()
      onSave(saved)
    } catch (error) {
      console.error('Failed to save lead:', error)
      toast.error(`Failed to ${lead?.id ? 'update' : 'create'} lead: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal modal-large" role="dialog" aria-modal="true" aria-label={lead ? `Edit ${lead.name || 'lead'}` : 'Add new lead'} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h2>{lead ? 'Edit Lead' : 'Add New Lead'}</h2>
          {lead?.id && (
            <Link to={`/leads/${lead.id}`} className="btn btn-sm btn-secondary" onClick={(e) => { if (!close()) e.preventDefault() }}>
              <ExternalLink size={14} /> Open full page
            </Link>
          )}
        </div>

        {duplicate && (
          <div className="form-duplicate-warning">
            <AlertTriangle size={16} />
            <div>
              <strong>
                <Link to={`/leads/${duplicate.lead.id}`}>{duplicate.lead.name}</Link>
                {duplicate.lead.firm_name ? ` — ${duplicate.lead.firm_name}` : ''}
              </strong>{' '}
              is already in the pipeline ({duplicate.lead.stage}), matched on{' '}
              {DUPLICATE_MATCH_LABELS[duplicate.matchedOn] || duplicate.matchedOn}.
              Saving will create a second record for them.
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Name *</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                onBlur={checkForDuplicate}
                placeholder="Full Name"
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label>Firm Name</label>
              <input
                type="text"
                name="firm_name"
                value={formData.firm_name}
                onChange={handleChange}
                onBlur={checkForDuplicate}
                placeholder="Company/Fund Name"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                onBlur={checkForDuplicate}
                placeholder="email@example.com"
              />
            </div>

            <div className="form-group">
              <label>Phone</label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>

          <div className="form-group">
            <label>LinkedIn URL</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
              <input
                type="url"
                name="linkedin_url"
                value={formData.linkedin_url}
                onChange={handleChange}
                onBlur={checkForDuplicate}
                placeholder="https://linkedin.com/in/..."
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleAutoFill}
                disabled={autoFilling || !formData.linkedin_url.trim()}
                title="Summarise what the CRM already knows about this lead. Does not read LinkedIn."
                style={{ whiteSpace: 'nowrap' }}
              >
                <Sparkles size={16} />
                {autoFilling ? 'Summarising...' : 'Summarise'}
              </button>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Lead Type</label>
              <select name="lead_type" value={formData.lead_type} onChange={handleChange}>
                <option value="">Select type...</option>
                {leadTypes.map(t => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Lead Source</label>
              <select name="lead_source" value={formData.lead_source} onChange={handleChange}>
                <option value="">Select source...</option>
                <option value="Dev's LinkedIn">Dev's LinkedIn</option>
                <option value="Siddhant's LinkedIn">Siddhant's LinkedIn</option>
                <option value="Aum's LinkedIn">Aum's LinkedIn</option>
                <option value="Referral">Referral</option>
                <option value="Cold Email">Cold Email</option>
                <option value="Event">Event</option>
                <option value="Website">Website</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Deal Criteria</label>
            <textarea
              name="deal_criteria"
              value={formData.deal_criteria}
              onChange={handleChange}
              placeholder="e.g., B2B SaaS, $1-5M revenue, 80%+ margins"
              rows={2}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Stage</label>
              <select name="stage" value={formData.stage} onChange={handleChange}>
                <option value="outreach">New Lead / Outreach</option>
                <option value="responded">Responded</option>
                <option value="meeting_booked">Meeting Booked</option>
                <option value="warm_active">Warm / Active</option>
                <option value="client">Client</option>
              </select>
            </div>

            <div className="form-group">
              <label>Outreach Stage</label>
              <select name="outreach_stage" value={formData.outreach_stage} onChange={handleChange}>
                <option value="">Not set</option>
                <option value="cold">Cold</option>
                <option value="messaged">Messaged</option>
                <option value="followup_1">Follow-up 1</option>
                <option value="followup_2">Follow-up 2</option>
                <option value="replied">Replied</option>
                <option value="meeting">Meeting</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Notes</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              placeholder="Initial conversation notes, context, etc."
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Message Content</label>
            <textarea
              name="message_content"
              value={formData.message_content}
              onChange={handleChange}
              placeholder="The outreach message sent to this lead…"
              rows={3}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Location</label>
              <input
                type="text"
                name="location"
                value={formData.location}
                onChange={handleChange}
                placeholder="City, Country"
              />
            </div>

            <div className="form-group">
              <label>Fit Score (1–5)</label>
              <select name="fit_score" value={formData.fit_score} onChange={handleChange}>
                <option value="">Not rated</option>
                <option value="1">1 — Poor fit</option>
                <option value="2">2 — Weak fit</option>
                <option value="3">3 — Moderate fit</option>
                <option value="4">4 — Good fit</option>
                <option value="5">5 — Excellent fit</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>First Contact Date</label>
            <input
              type="date"
              name="first_contact_date"
              value={formData.first_contact_date}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Tags</label>
            {!lead?.id ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>Save the lead first to add tags.</p>
            ) : (<>
              {leadTags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                  {leadTags.map(tag => (
                    <span key={tag.id} style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      background: 'var(--blue-50, #eff6ff)', color: 'var(--blue-700, #1d4ed8)',
                      border: '1px solid var(--blue-200, #bfdbfe)',
                      borderRadius: '12px', padding: '2px 8px', fontSize: '12px', fontWeight: 500
                    }}>
                      {tag.name}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag.id)}
                        disabled={tagBusy}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'inherit', opacity: 0.6 }}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: '6px' }}>
                <select
                  value={tagSelectVal}
                  onChange={e => setTagSelectVal(e.target.value)}
                  style={{ flex: 1, fontSize: '13px' }}
                  disabled={tagBusy}
                >
                  <option value="">Add existing tag…</option>
                  {allTags.filter(t => !leadTags.some(lt => lt.id === t.id)).map(t => (
                    <option key={t.id} value={String(t.id)}>{t.name}</option>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary" onClick={handleAddTag} disabled={!tagSelectVal || tagBusy} style={{ padding: '6px 10px', fontSize: '13px' }}>
                  Add
                </button>
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                <input
                  type="text"
                  value={newTagName}
                  onChange={e => setNewTagName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateTag() } }}
                  placeholder="Or create new tag…"
                  style={{ flex: 1, fontSize: '13px' }}
                  disabled={tagBusy}
                />
                <button type="button" className="btn btn-secondary" onClick={handleCreateTag} disabled={!newTagName.trim() || tagBusy} style={{ padding: '6px 10px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Plus size={13} /> Create
                </button>
              </div>
            </>)}
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : lead ? 'Update Lead' : 'Add Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default LeadForm
