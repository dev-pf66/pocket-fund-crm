import { useState, useEffect } from 'react'
import { useApp } from '../App'
import { getGoalTemplates, createGoalTemplate, updateGoalTemplate, deleteGoalTemplate, getPeople } from '../lib/crm-api'
import { Target, Plus, Trash2, GripVertical, Save, X } from 'lucide-react'
import { useToast } from '../components/Toast'

function GoalTemplates() {
  const { currentPerson, people } = useApp()
  const { toast } = useToast()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedPerson, setSelectedPerson] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [newGoalText, setNewGoalText] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)

  useEffect(() => {
    loadTemplates()
  }, [selectedPerson])

  async function loadTemplates() {
    setLoading(true)
    try {
      const filters = selectedPerson ? { person_id: parseInt(selectedPerson) } : {}
      const data = await getGoalTemplates(filters)
      setTemplates(data)
    } catch (err) {
      console.error('Failed to load templates:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddTemplate() {
    if (!newGoalText.trim()) return

    try {
      await createGoalTemplate({
        person_id: selectedPerson ? parseInt(selectedPerson) : null,
        goal_text: newGoalText.trim(),
        goal_order: templates.length
      })
      setNewGoalText('')
      setShowAddForm(false)
      await loadTemplates()
    } catch (err) {
      console.error('Failed to add template:', err)
      toast.error('Failed to add goal template')
    }
  }

  async function handleUpdateTemplate(id, updates) {
    try {
      await updateGoalTemplate(id, updates)
      await loadTemplates()
      setEditingId(null)
    } catch (err) {
      console.error('Failed to update template:', err)
      toast.error('Failed to update template')
    }
  }

  async function handleDeleteTemplate(id) {
    if (!confirm('Delete this goal template?')) return

    try {
      await deleteGoalTemplate(id)
      await loadTemplates()
    } catch (err) {
      console.error('Failed to delete template:', err)
      toast.error('Failed to delete template')
    }
  }

  const selectedPersonName = selectedPerson
    ? people.find(p => p.id === parseInt(selectedPerson))?.name || 'Unknown'
    : 'All People'

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
            <Target size={24} /> Weekly Goal Templates
          </h1>
          <p style={{ color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
            Set default weekly goals for each team member
          </p>
        </div>
      </div>

      {/* Person Filter */}
      <div className="card" style={{ padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '14px', fontWeight: '500' }}>Show templates for:</label>
          <select
            value={selectedPerson}
            onChange={(e) => setSelectedPerson(e.target.value)}
            className="form-control"
            style={{ width: 'auto', minWidth: '200px' }}
          >
            <option value="">All People</option>
            {people.map(person => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
          </select>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowAddForm(true)}
            style={{ marginLeft: 'auto' }}
          >
            <Plus size={16} /> Add Goal Template
          </button>
        </div>
      </div>

      {/* Add New Template Form */}
      {showAddForm && (
        <div className="card" style={{ padding: '20px', marginBottom: '20px', background: '#f0fdf4', borderColor: '#86efac' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>Add New Goal Template for {selectedPersonName}</h3>
          <div style={{ display: 'flex', gap: '12px' }}>
            <input
              type="text"
              className="form-control"
              placeholder="Enter goal text (e.g., 'Send 15 cold outreach messages')"
              value={newGoalText}
              onChange={(e) => setNewGoalText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTemplate()}
              autoFocus
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={handleAddTemplate}>
              <Save size={16} /> Save
            </button>
            <button className="btn btn-secondary" onClick={() => {
              setShowAddForm(false)
              setNewGoalText('')
            }}>
              <X size={16} /> Cancel
            </button>
          </div>
        </div>
      )}

      {/* Templates List */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 12px' }}></div>
            Loading templates…
          </div>
        ) : templates.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
            <Target size={48} style={{ opacity: 0.3, margin: '0 auto 12px' }} />
            <p style={{ margin: 0 }}>
              {selectedPerson ? 'No goal templates for this person yet.' : 'No goal templates yet.'}
            </p>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddForm(true)}
              style={{ marginTop: '16px' }}
            >
              <Plus size={16} /> Add First Template
            </button>
          </div>
        ) : (
          <div style={{ padding: '20px' }}>
            <div style={{ marginBottom: '12px', fontSize: '13px', color: '#6b7280', fontWeight: '500' }}>
              {templates.length} {templates.length === 1 ? 'template' : 'templates'} for {selectedPersonName}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {templates.map((template) => (
                <div
                  key={template.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 16px',
                    background: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    transition: 'all 0.2s'
                  }}
                >
                  <GripVertical size={16} style={{ color: '#9ca3af', cursor: 'grab' }} />

                  {editingId === template.id ? (
                    <>
                      <input
                        type="text"
                        className="form-control"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleUpdateTemplate(template.id, { goal_text: editText })
                          } else if (e.key === 'Escape') {
                            setEditingId(null)
                          }
                        }}
                        autoFocus
                        style={{ flex: 1 }}
                      />
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleUpdateTemplate(template.id, { goal_text: editText })}
                      >
                        <Save size={14} /> Save
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => setEditingId(null)}
                      >
                        <X size={14} /> Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <div
                        style={{ flex: 1, cursor: 'pointer', fontSize: '14px', color: '#374151' }}
                        onClick={() => {
                          setEditingId(template.id)
                          setEditText(template.goal_text)
                        }}
                      >
                        {template.goal_text}
                      </div>
                      <button
                        className="icon-btn"
                        onClick={() => handleDeleteTemplate(template.id)}
                        title="Delete template"
                        style={{ color: '#dc2626' }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="card" style={{ padding: '16px', marginTop: '20px', background: '#eff6ff', borderColor: '#bfdbfe' }}>
        <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: '#1e40af' }}>💡 How it works</h4>
        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#1e3a8a' }}>
          <li>Templates define default weekly goals for each person</li>
          <li>When someone views their weekly goals, these templates auto-populate</li>
          <li>Each person can then customize their weekly goals as needed</li>
          <li>Templates make it easy to ensure consistent expectations across weeks</li>
        </ul>
      </div>
    </div>
  )
}

export default GoalTemplates
