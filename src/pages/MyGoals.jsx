import { useState, useEffect } from 'react'
import { useApp } from '../App'
import {
  getGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  incrementGoalProgress
} from '../lib/crm-api'
import { Target, Plus, Trash2, Edit2, Save, X, Minus } from 'lucide-react'
import { useToast } from '../components/Toast'
import { useSessionState } from '../hooks/useSessionState'

const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' }
]

const EMPTY_DRAFT = { goal_text: '', target_count: 10, frequency: 'daily' }

function MyGoals() {
  const { currentPerson, people } = useApp()
  const { toast } = useToast()
  const [selectedPersonId, setSelectedPersonId] = useSessionState('goals:selectedPersonId', null)
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useSessionState('goals:showAddForm', false)
  const [draft, setDraft, clearDraft] = useSessionState('goals:draft', EMPTY_DRAFT)
  const [editingId, setEditingId, clearEditingId] = useSessionState('goals:editingId', null)
  const [editDraft, setEditDraft] = useSessionState('goals:editDraft', EMPTY_DRAFT)
  const [savingGoal, setSavingGoal] = useState(false)

  useEffect(() => {
    if (currentPerson?.id && !selectedPersonId) {
      setSelectedPersonId(currentPerson.id)
    }
  }, [currentPerson, selectedPersonId])

  useEffect(() => {
    if (selectedPersonId) loadGoals()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPersonId])

  async function loadGoals() {
    setLoading(true)
    try {
      const data = await getGoals(selectedPersonId)
      setGoals(data)
    } catch (err) {
      console.error('Failed to load goals:', err)
      toast.error('Failed to load goals')
    } finally {
      setLoading(false)
    }
  }

  async function handleAddGoal() {
    if (!draft.goal_text.trim()) {
      toast.warn('Goal text is required')
      return
    }
    if (!draft.target_count || draft.target_count < 1) {
      toast.warn('Target count must be at least 1')
      return
    }

    setSavingGoal(true)
    try {
      await createGoal({
        person_id: selectedPersonId,
        goal_text: draft.goal_text.trim(),
        target_count: Number(draft.target_count),
        frequency: draft.frequency,
        goal_order: goals.length
      })
      clearDraft()
      setShowAddForm(false)
      await loadGoals()
    } catch (err) {
      console.error('Failed to add goal:', err)
      toast.error('Failed to add goal')
    } finally {
      setSavingGoal(false)
    }
  }

  function startEdit(goal) {
    setEditingId(goal.id)
    setEditDraft({
      goal_text: goal.goal_text,
      target_count: goal.target_count,
      frequency: goal.frequency
    })
  }

  async function handleSaveEdit(id) {
    if (!editDraft.goal_text.trim()) {
      toast.warn('Goal text is required')
      return
    }
    if (!editDraft.target_count || editDraft.target_count < 1) {
      toast.warn('Target count must be at least 1')
      return
    }
    try {
      await updateGoal(id, {
        goal_text: editDraft.goal_text.trim(),
        target_count: Number(editDraft.target_count),
        frequency: editDraft.frequency
      })
      clearEditingId()
      await loadGoals()
    } catch (err) {
      console.error('Failed to update goal:', err)
      toast.error('Failed to update goal')
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this goal? All progress history will be removed.')) return
    try {
      await deleteGoal(id)
      await loadGoals()
    } catch (err) {
      console.error('Failed to delete goal:', err)
      toast.error('Failed to delete goal')
    }
  }

  async function handleIncrement(goalId, delta) {
    // Optimistic update
    setGoals(prev => prev.map(g =>
      g.id === goalId ? { ...g, current_count: Math.max(0, g.current_count + delta) } : g
    ))
    try {
      await incrementGoalProgress(goalId, delta)
    } catch (err) {
      console.error('Failed to update progress:', err)
      toast.error('Failed to update progress')
      await loadGoals() // rollback
    }
  }

  const selectedPerson = people.find(p => p.id === selectedPersonId)
  const isViewingSelf = selectedPersonId === currentPerson?.id

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
            <Target size={24} /> Goals
          </h1>
          <p style={{ color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
            Track recurring targets. Tap + as you make progress.
          </p>
        </div>
      </div>

      {/* Person selector + Add button */}
      <div className="card" style={{ padding: '16px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151' }}>Viewing goals for:</label>
          <select
            value={selectedPersonId || ''}
            onChange={(e) => setSelectedPersonId(Number(e.target.value))}
            style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px' }}
          >
            {people.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.id === currentPerson?.id ? ' (me)' : ''}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowAddForm(v => !v)}
        >
          <Plus size={16} /> Add Goal
        </button>
      </div>

      {/* Add Goal form */}
      {showAddForm && (
        <div className="card" style={{ padding: '16px', marginBottom: '20px', background: '#f0fdf4', border: '1px solid #86efac' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: '600' }}>
            New goal for {selectedPerson?.name}{isViewingSelf ? ' (me)' : ''}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 140px auto', gap: '10px', alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>Goal</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g., LinkedIn outreaches"
                value={draft.goal_text}
                onChange={(e) => setDraft(d => ({ ...d, goal_text: e.target.value }))}
                autoFocus
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>Target count</label>
              <input
                type="number"
                className="form-control"
                min="1"
                value={draft.target_count}
                onChange={(e) => setDraft(d => ({ ...d, target_count: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>Frequency</label>
              <select
                className="form-control"
                value={draft.frequency}
                onChange={(e) => setDraft(d => ({ ...d, frequency: e.target.value }))}
              >
                {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button className="btn btn-primary btn-sm" onClick={handleAddGoal} disabled={savingGoal}>
                <Save size={14} /> {savingGoal ? 'Saving…' : 'Save'}
              </button>
              <button className="btn btn-sm" onClick={() => { setShowAddForm(false); clearDraft() }}>
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Goals list */}
      <div className="card" style={{ padding: '20px' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 12px' }}></div>
            Loading goals…
          </div>
        ) : goals.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
            <Target size={48} style={{ opacity: 0.3, margin: '0 auto 12px' }} />
            <p style={{ margin: '0 0 16px' }}>No goals yet for {selectedPerson?.name}.</p>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddForm(true)}
            >
              <Plus size={16} /> Add First Goal
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {goals.map(goal => (
              <GoalCard
                key={goal.id}
                goal={goal}
                isEditing={editingId === goal.id}
                editDraft={editDraft}
                setEditDraft={setEditDraft}
                onStartEdit={() => startEdit(goal)}
                onCancelEdit={() => clearEditingId()}
                onSaveEdit={() => handleSaveEdit(goal.id)}
                onDelete={() => handleDelete(goal.id)}
                onIncrement={(delta) => handleIncrement(goal.id, delta)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function GoalCard({ goal, isEditing, editDraft, setEditDraft, onStartEdit, onCancelEdit, onSaveEdit, onDelete, onIncrement }) {
  const pct = Math.min(100, Math.round((goal.current_count / goal.target_count) * 100))
  const done = goal.current_count >= goal.target_count
  const frequencyLabel = FREQUENCIES.find(f => f.value === goal.frequency)?.label || goal.frequency

  if (isEditing) {
    return (
      <div style={{
        padding: '14px',
        background: '#f9fafb',
        border: '1px solid #d1d5db',
        borderRadius: '8px',
        display: 'grid',
        gridTemplateColumns: '1fr 120px 140px auto',
        gap: '10px',
        alignItems: 'end'
      }}>
        <input
          type="text"
          className="form-control"
          value={editDraft.goal_text}
          onChange={(e) => setEditDraft(d => ({ ...d, goal_text: e.target.value }))}
          autoFocus
        />
        <input
          type="number"
          className="form-control"
          min="1"
          value={editDraft.target_count}
          onChange={(e) => setEditDraft(d => ({ ...d, target_count: e.target.value }))}
        />
        <select
          className="form-control"
          value={editDraft.frequency}
          onChange={(e) => setEditDraft(d => ({ ...d, frequency: e.target.value }))}
        >
          {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button className="btn btn-primary btn-sm" onClick={onSaveEdit}>
            <Save size={14} />
          </button>
          <button className="btn btn-sm" onClick={onCancelEdit}>
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      padding: '14px 16px',
      background: done ? '#f0fdf4' : 'white',
      border: '1px solid',
      borderColor: done ? '#86efac' : '#e5e7eb',
      borderRadius: '8px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '12px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '15px', fontWeight: '600', color: '#111827' }}>
            {goal.goal_text}
          </div>
          <span style={{
            fontSize: '11px',
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: '0.4px',
            padding: '2px 8px',
            borderRadius: '12px',
            background: '#eef2ff',
            color: '#4338ca'
          }}>
            {frequencyLabel}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button className="icon-btn" onClick={onStartEdit} title="Edit goal">
            <Edit2 size={14} />
          </button>
          <button className="icon-btn" onClick={onDelete} title="Delete goal" style={{ color: '#dc2626' }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          className="btn btn-sm"
          onClick={() => onIncrement(-1)}
          disabled={goal.current_count <= 0}
          title="Decrement"
          style={{ minWidth: '36px', justifyContent: 'center' }}
        >
          <Minus size={14} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
            <span style={{ fontWeight: '600', color: done ? '#16a34a' : '#111827' }}>
              {goal.current_count} / {goal.target_count}
            </span>
            <span>{pct}%</span>
          </div>
          <div style={{ height: '8px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{
              width: `${pct}%`,
              height: '100%',
              background: done ? '#16a34a' : '#1d4ed8',
              transition: 'width 0.3s ease'
            }} />
          </div>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => onIncrement(1)}
          title="Increment"
          style={{ minWidth: '48px', justifyContent: 'center' }}
        >
          <Plus size={14} /> 1
        </button>
      </div>
    </div>
  )
}

export default MyGoals
