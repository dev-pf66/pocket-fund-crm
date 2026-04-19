import { useState } from 'react'
import { createLead, updateLead } from '../lib/crm-api'
import { useApp } from '../App'
import { useToast } from '../components/Toast'

function LeadForm({ onClose, onSave, lead = null }) {
  const { currentPerson } = useApp()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: lead?.name || '',
    firm_name: lead?.firm_name || '',
    email: lead?.email || '',
    phone: lead?.phone || '',
    linkedin_url: lead?.linkedin_url || '',
    lead_type: lead?.lead_type || '',
    deal_criteria: lead?.deal_criteria || '',
    stage: lead?.stage || 'new_lead',
    lead_source: lead?.lead_source || '',
    notes: lead?.notes || ''
  })

  function handleChange(e) {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
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
      if (lead?.id) {
        await updateLead(lead.id, formData)
      } else {
        await createLead(formData, currentPerson.id)
      }
      onSave()
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
            <input
              type="url"
              name="linkedin_url"
              value={formData.linkedin_url}
              onChange={handleChange}
              placeholder="https://linkedin.com/in/..."
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Lead Type</label>
              <select name="lead_type" value={formData.lead_type} onChange={handleChange}>
                <option value="">Select type...</option>
                <option value="Independent Sponsor">Independent Sponsor</option>
                <option value="PE Firm">PE Firm</option>
                <option value="Family Office">Family Office</option>
                <option value="Other">Other</option>
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

          <div className="form-group">
            <label>Stage</label>
            <select name="stage" value={formData.stage} onChange={handleChange}>
              <option value="new_lead">New Lead</option>
              <option value="cold_outreach">Cold Outreach</option>
              <option value="responded">Responded</option>
              <option value="warm_lead">Warm Lead</option>
              <option value="active_conversation">Active Conversation</option>
              <option value="client">Client</option>
            </select>
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
