import { useState, useEffect } from 'react'
import { getEmailTemplates, createEmailTemplate, updateEmailTemplate, deleteEmailTemplate } from '../lib/crm-api'
import { useApp } from '../App'
import { Copy, Plus, Edit2, Trash2, Check } from 'lucide-react'

function EmailTemplates() {
  const { currentPerson } = useApp()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [copiedId, setCopiedId] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    subject: '',
    body: '',
    category: 'outreach'
  })

  useEffect(() => {
    loadTemplates()
  }, [])

  async function loadTemplates() {
    setLoading(true)
    try {
      const data = await getEmailTemplates()
      setTemplates(data)
    } catch (error) {
      console.error('Failed to load templates:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    try {
      if (editingTemplate) {
        await updateEmailTemplate(editingTemplate.id, formData)
      } else {
        await createEmailTemplate({ ...formData, created_by: currentPerson?.id })
      }
      setFormData({ name: '', subject: '', body: '', category: 'outreach' })
      setEditingTemplate(null)
      setShowForm(false)
      await loadTemplates()
    } catch (error) {
      console.error('Failed to save template:', error)
      alert('Failed to save template')
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this template?')) return

    try {
      await deleteEmailTemplate(id)
      await loadTemplates()
    } catch (error) {
      console.error('Failed to delete template:', error)
      alert('Failed to delete template')
    }
  }

  function handleEdit(template) {
    setFormData({
      name: template.name,
      subject: template.subject,
      body: template.body,
      category: template.category
    })
    setEditingTemplate(template)
    setShowForm(true)
  }

  function copyToClipboard(text, id) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const categories = {
    outreach: 'Cold Outreach',
    followup: 'Follow-up',
    samples: 'Sample Deals',
    proposal: 'Proposal',
    meeting: 'Meeting Request'
  }

  if (loading) {
    return <div className="loading">Loading templates...</div>
  }

  return (
    <div>
      <div className="page-header">
        <h1>Email Templates</h1>
        <button
          className="btn btn-primary"
          onClick={() => {
            setShowForm(true)
            setEditingTemplate(null)
            setFormData({ name: '', subject: '', body: '', category: 'outreach' })
          }}
        >
          <Plus size={18} />
          New Template
        </button>
      </div>

      <div className="templates-info">
        <p><strong>Variables you can use:</strong></p>
        <div className="variables-list">
          <code>{'{name}'}</code> - Lead name
          <code>{'{firm}'}</code> - Firm name
          <code>{'{criteria}'}</code> - Deal criteria
          <code>{'{your_name}'}</code> - Your name
        </div>
      </div>

      {showForm && (
        <div className="card template-form">
          <h2>{editingTemplate ? 'Edit Template' : 'New Template'}</h2>

          <div className="form-group">
            <label>Template Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Initial Outreach - PE Firm"
            />
          </div>

          <div className="form-group">
            <label>Category</label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            >
              {Object.entries(categories).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Email Subject *</label>
            <input
              type="text"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              placeholder="Subject line with {name} or {firm}"
            />
          </div>

          <div className="form-group">
            <label>Email Body *</label>
            <textarea
              value={formData.body}
              onChange={(e) => setFormData({ ...formData, body: e.target.value })}
              placeholder="Email body with {name}, {firm}, {criteria}, etc."
              rows={12}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!formData.name || !formData.subject || !formData.body}
            >
              {editingTemplate ? 'Update Template' : 'Create Template'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setShowForm(false)
                setEditingTemplate(null)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="templates-grid">
        {templates.length === 0 && !showForm && (
          <div className="empty-state">
            <p>No templates yet. Create your first email template!</p>
          </div>
        )}

        {Object.entries(categories).map(([categoryKey, categoryLabel]) => {
          const categoryTemplates = templates.filter(t => t.category === categoryKey)
          if (categoryTemplates.length === 0) return null

          return (
            <div key={categoryKey} className="template-category">
              <h3>{categoryLabel}</h3>
              <div className="templates-list">
                {categoryTemplates.map(template => (
                  <div key={template.id} className="template-card">
                    <div className="template-header">
                      <h4>{template.name}</h4>
                      <div className="template-actions">
                        <button
                          className="icon-btn"
                          onClick={() => copyToClipboard(template.body, template.id)}
                          title="Copy to clipboard"
                        >
                          {copiedId === template.id ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => handleEdit(template)}
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => handleDelete(template.id)}
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="template-subject">
                      <strong>Subject:</strong> {template.subject}
                    </div>

                    <div className="template-body">
                      {template.body}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default EmailTemplates
