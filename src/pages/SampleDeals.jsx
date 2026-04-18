import { useState, useEffect } from 'react'
import { getSampleDeals, createSampleDeal, updateSampleDeal, deleteSampleDeal } from '../lib/crm-api'
import { useApp } from '../App'
import { Plus, Edit2, Trash2, ExternalLink } from 'lucide-react'
import { useToast } from '../components/Toast'

function SampleDeals() {
  const { currentPerson } = useApp()
  const { toast } = useToast()
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingDeal, setEditingDeal] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    client_type: '',
    deal_size_range: '',
    industry: '',
    what_we_did: '',
    outcome: '',
    timeline: '',
    metrics: ''
  })

  useEffect(() => {
    loadDeals()
  }, [])

  async function loadDeals() {
    setLoading(true)
    try {
      const data = await getSampleDeals()
      setDeals(data)
    } catch (error) {
      console.error('Failed to load sample deals:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    try {
      if (editingDeal) {
        await updateSampleDeal(editingDeal.id, formData)
      } else {
        await createSampleDeal({ ...formData, created_by: currentPerson?.id })
      }
      resetForm()
      await loadDeals()
    } catch (error) {
      console.error('Failed to save sample deal:', error)
      toast.error('Failed to save sample deal')
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this sample deal?')) return

    try {
      await deleteSampleDeal(id)
      await loadDeals()
    } catch (error) {
      console.error('Failed to delete sample deal:', error)
      toast.error('Failed to delete sample deal')
    }
  }

  function handleEdit(deal) {
    setFormData({
      title: deal.title,
      description: deal.description || '',
      client_type: deal.client_type || '',
      deal_size_range: deal.deal_size_range || '',
      industry: deal.industry || '',
      what_we_did: deal.what_we_did || '',
      outcome: deal.outcome || '',
      timeline: deal.timeline || '',
      metrics: deal.metrics || ''
    })
    setEditingDeal(deal)
    setShowForm(true)
  }

  function resetForm() {
    setFormData({
      title: '',
      description: '',
      client_type: '',
      deal_size_range: '',
      industry: '',
      what_we_did: '',
      outcome: '',
      timeline: '',
      metrics: ''
    })
    setEditingDeal(null)
    setShowForm(false)
  }

  if (loading) {
    return <div className="loading">Loading sample deals...</div>
  }

  return (
    <div>
      <div className="page-header">
        <h1>Sample Deals Library</h1>
        <button
          className="btn btn-primary"
          onClick={() => {
            resetForm()
            setShowForm(true)
          }}
        >
          <Plus size={18} />
          New Sample Deal
        </button>
      </div>

      <div className="sample-deals-info">
        <p>Manage your case studies and success stories. Tag them by industry and client type to easily find relevant examples for prospects.</p>
      </div>

      {showForm && (
        <div className="card sample-deal-form">
          <h2>{editingDeal ? 'Edit Sample Deal' : 'New Sample Deal'}</h2>

          <div className="form-grid">
            <div className="form-group full-width">
              <label>Title *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Q4 2025 - B2B SaaS Acquisition for Independent Sponsor"
              />
            </div>

            <div className="form-group full-width">
              <label>Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief overview of the deal"
                rows={3}
              />
            </div>

            <div className="form-group">
              <label>Client Type</label>
              <select
                value={formData.client_type}
                onChange={(e) => setFormData({ ...formData, client_type: e.target.value })}
              >
                <option value="">Select type</option>
                <option value="PE Firm">PE Firm</option>
                <option value="Family Office">Family Office</option>
                <option value="Independent Sponsor">Independent Sponsor</option>
                <option value="Strategic Buyer">Strategic Buyer</option>
              </select>
            </div>

            <div className="form-group">
              <label>Deal Size Range</label>
              <input
                type="text"
                value={formData.deal_size_range}
                onChange={(e) => setFormData({ ...formData, deal_size_range: e.target.value })}
                placeholder="e.g., $2-5M"
              />
            </div>

            <div className="form-group">
              <label>Industry</label>
              <input
                type="text"
                value={formData.industry}
                onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                placeholder="e.g., B2B SaaS, E-commerce"
              />
            </div>

            <div className="form-group">
              <label>Timeline</label>
              <input
                type="text"
                value={formData.timeline}
                onChange={(e) => setFormData({ ...formData, timeline: e.target.value })}
                placeholder="e.g., 8 weeks from LOI to close"
              />
            </div>

            <div className="form-group full-width">
              <label>What We Did</label>
              <textarea
                value={formData.what_we_did}
                onChange={(e) => setFormData({ ...formData, what_we_did: e.target.value })}
                placeholder="Services provided, approach taken, etc."
                rows={4}
              />
            </div>

            <div className="form-group full-width">
              <label>Outcome</label>
              <textarea
                value={formData.outcome}
                onChange={(e) => setFormData({ ...formData, outcome: e.target.value })}
                placeholder="Results achieved, client feedback, etc."
                rows={3}
              />
            </div>

            <div className="form-group full-width">
              <label>Key Metrics</label>
              <textarea
                value={formData.metrics}
                onChange={(e) => setFormData({ ...formData, metrics: e.target.value })}
                placeholder="e.g., Sourced 25 targets, 12 NDAs signed, closed in 6 weeks"
                rows={2}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!formData.title}
            >
              {editingDeal ? 'Update Deal' : 'Create Deal'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={resetForm}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="sample-deals-grid">
        {deals.length === 0 && !showForm && (
          <div className="empty-state">
            <p>No sample deals yet. Create your first case study!</p>
          </div>
        )}

        {deals.map(deal => (
          <div key={deal.id} className="sample-deal-card">
            <div className="sample-deal-header">
              <h3>{deal.title}</h3>
              <div className="sample-deal-actions">
                <button
                  className="icon-btn"
                  onClick={() => handleEdit(deal)}
                  title="Edit"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => handleDelete(deal.id)}
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div className="sample-deal-tags">
              {deal.client_type && (
                <span className="tag tag-client-type">{deal.client_type}</span>
              )}
              {deal.industry && (
                <span className="tag tag-industry">{deal.industry}</span>
              )}
              {deal.deal_size_range && (
                <span className="tag tag-size">{deal.deal_size_range}</span>
              )}
            </div>

            {deal.description && (
              <p className="sample-deal-description">{deal.description}</p>
            )}

            <div className="sample-deal-details">
              {deal.what_we_did && (
                <div className="detail-section">
                  <strong>What We Did</strong>
                  <p>{deal.what_we_did}</p>
                </div>
              )}

              {deal.outcome && (
                <div className="detail-section">
                  <strong>Outcome</strong>
                  <p>{deal.outcome}</p>
                </div>
              )}

              {deal.metrics && (
                <div className="detail-section">
                  <strong>Key Metrics</strong>
                  <p>{deal.metrics}</p>
                </div>
              )}

              {deal.timeline && (
                <div className="detail-section">
                  <strong>Timeline</strong>
                  <p>{deal.timeline}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default SampleDeals
