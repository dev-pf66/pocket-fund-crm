import { useState } from 'react'
import { createLead, updateLead, previewLinkedInEnrichment } from '../lib/crm-api'
import { isLinkedInUrl, nameFromLinkedInUrl } from '../lib/linkedin'
import { useApp } from '../App'
import { useToast } from '../components/Toast'
import { useSessionState } from '../hooks/useSessionState'
import { useLeadTypes } from '../hooks/useLeadTypes'
import { Sparkles } from 'lucide-react'

function LeadForm({ onClose, onSave, lead = null }) {
  const { currentPerson } = useApp()
  const { toast } = useToast()
  const leadTypes = useLeadTypes()
  const [loading, setLoading] = useState(false)
  const [autoFilling, setAutoFilling] = useState(false)
  // Only persist the new-lead draft across navigation; edit mode is seeded
  // from the `lead` prop so persistence would desync if the lead changed.
  const initialForm = {
    name: lead?.name || '',
    firm_name: lead?.firm_name || '',
    email: lead?.email || '',
    phone: lead?.phone || '',
    linkedin_url: lead?.linkedin_url || '',
    lead_type: lead?.lead_type || '',
    outreach_stage: lead?.outreach_stage || '',
    deal_criteria: lead?.deal_criteria || '',
    stage: lead?.stage || 'new_lead',
    lead_source: lead?.lead_source || '',
    notes: lead?.notes || ''
  }
  const [formData, setFormData, clearFormData] = useSessionState(
    lead ? `lf:edit:${lead.id}` : 'lf:new',
    initialForm
  )

  function handleChange(e) {
    const { name, value } = e.target
    setFormData(prev => {
      const next = { ...prev, [name]: value }
      // When pasting a LinkedIn URL and name is empty, pre-populate the name
      // from the slug so the user doesn't have to retype it.
      if (name === 'linkedin_url' && !prev.name.trim() && isLinkedInUrl(value)) {
        const guessed = nameFromLinkedInUrl(value)
        if (guessed) next.name = guessed
      }
      return next
    })
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
      toast.success('Auto-filled from LinkedIn')
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
        outreach_stage: formData.outreach_stage || null
      }
      let saved
      if (lead?.id) {
        saved = await updateLead(lead.id, payload, currentPerson.id)
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
        <h2>{lead ? 'Edit Lead' : 'Add New Lead'}</h2>

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Name *</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
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
                placeholder="https://linkedin.com/in/..."
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleAutoFill}
                disabled={autoFilling || !formData.linkedin_url.trim()}
                title="Fill name, lead type, and notes from the LinkedIn URL"
                style={{ whiteSpace: 'nowrap' }}
              >
                <Sparkles size={16} />
                {autoFilling ? 'Filling...' : 'Auto-fill'}
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
                <option value="LinkedIn">LinkedIn</option>
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
                <option value="new_lead">New Lead</option>
                <option value="cold_outreach">Cold Outreach</option>
                <option value="responded">Responded</option>
                <option value="warm_lead">Warm Lead</option>
                <option value="active_conversation">Active Conversation</option>
                <option value="meeting_booked">Meeting</option>
                <option value="client">Client</option>
              </select>
            </div>

            <div className="form-group">
              <label>Outreach Stage</label>
              <select name="outreach_stage" value={formData.outreach_stage} onChange={handleChange}>
                <option value="">Not set</option>
                <option value="cold">Cold</option>
                <option value="messaged">Messaged</option>
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

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
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
