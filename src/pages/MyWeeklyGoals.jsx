import { useState, useEffect } from 'react'
import { useApp } from '../App'
import {
  getWeeklyGoals,
  initializeWeeklyGoals,
  addWeeklyGoal,
  updateWeeklyGoal,
  deleteWeeklyGoal,
  getWeekStartDate,
  getWeeklyGoalStats
} from '../lib/crm-api'
import { Target, Plus, Trash2, Check, ChevronLeft, ChevronRight, Edit2, Save, X } from 'lucide-react'
import { useToast } from '../components/Toast'

function MyWeeklyGoals() {
  const { currentPerson } = useApp()
  const { toast } = useToast()
  const [goals, setGoals] = useState([])
  const [stats, setStats] = useState({ total: 0, completed: 0, remaining: 0, percentage: 0 })
  const [loading, setLoading] = useState(true)
  const [currentWeekStart, setCurrentWeekStart] = useState(getWeekStartDate())
  const [newGoalText, setNewGoalText] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')

  useEffect(() => {
    if (currentPerson?.id) {
      loadGoals()
    }
  }, [currentPerson, currentWeekStart])

  async function loadGoals() {
    if (!currentPerson?.id) return

    setLoading(true)
    try {
      let goalsData = await getWeeklyGoals(currentPerson.id, currentWeekStart)

      // If no goals exist for this week, initialize from templates
      if (goalsData.length === 0) {
        goalsData = await initializeWeeklyGoals(currentPerson.id, currentWeekStart)
      }

      setGoals(goalsData)

      // Get stats
      const statsData = await getWeeklyGoalStats(currentPerson.id, currentWeekStart)
      setStats(statsData)
    } catch (err) {
      console.error('Failed to load goals:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleGoal(goal) {
    try {
      await updateWeeklyGoal(goal.id, { is_completed: !goal.is_completed })
      await loadGoals()
    } catch (err) {
      console.error('Failed to toggle goal:', err)
      toast.error('Failed to update goal')
    }
  }

  async function handleAddGoal() {
    if (!newGoalText.trim()) return

    try {
      await addWeeklyGoal({
        person_id: currentPerson.id,
        week_start_date: currentWeekStart,
        goal_text: newGoalText.trim(),
        goal_order: goals.length
      })
      setNewGoalText('')
      setShowAddForm(false)
      await loadGoals()
    } catch (err) {
      console.error('Failed to add goal:', err)
      toast.error('Failed to add goal')
    }
  }

  async function handleUpdateGoal(id) {
    try {
      await updateWeeklyGoal(id, { goal_text: editText })
      setEditingId(null)
      await loadGoals()
    } catch (err) {
      console.error('Failed to update goal:', err)
      toast.error('Failed to update goal')
    }
  }

  async function handleDeleteGoal(id) {
    if (!confirm('Delete this goal?')) return

    try {
      await deleteWeeklyGoal(id)
      await loadGoals()
    } catch (err) {
      console.error('Failed to delete goal:', err)
      toast.error('Failed to delete goal')
    }
  }

  function navigateWeek(direction) {
    const current = new Date(currentWeekStart)
    current.setDate(current.getDate() + (direction * 7))
    setCurrentWeekStart(getWeekStartDate(current))
  }

  function goToCurrentWeek() {
    setCurrentWeekStart(getWeekStartDate())
  }

  const weekEnd = new Date(currentWeekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)

  const isCurrentWeek = currentWeekStart === getWeekStartDate()

  const weekLabel = `${new Date(currentWeekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
            <Target size={24} /> My Weekly Goals
          </h1>
          <p style={{ color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
            Track your progress for the week
          </p>
        </div>
      </div>

      {/* Week Navigator */}
      <div className="card" style={{ padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="btn btn-sm" onClick={() => navigateWeek(-1)}>
              <ChevronLeft size={16} /> Prev Week
            </button>
            <div style={{ fontSize: '16px', fontWeight: '600', color: '#374151' }}>
              {weekLabel}
              {isCurrentWeek && <span style={{ marginLeft: '8px', fontSize: '12px', color: '#16a34a', fontWeight: '500' }}>(This Week)</span>}
            </div>
            <button className="btn btn-sm" onClick={() => navigateWeek(1)}>
              Next Week <ChevronRight size={16} />
            </button>
          </div>
          {!isCurrentWeek && (
            <button className="btn btn-primary btn-sm" onClick={goToCurrentWeek}>
              Go to Current Week
            </button>
          )}
        </div>
      </div>

      {/* Progress Stats */}
      <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Weekly Progress</h3>
          <span style={{ fontSize: '24px', fontWeight: '700', color: stats.percentage === 100 ? '#16a34a' : '#1d4ed8' }}>
            {stats.percentage}%
          </span>
        </div>
        <div style={{ width: '100%', height: '12px', background: '#e5e7eb', borderRadius: '6px', overflow: 'hidden', marginBottom: '12px' }}>
          <div
            style={{
              width: `${stats.percentage}%`,
              height: '100%',
              background: stats.percentage === 100 ? '#16a34a' : '#1d4ed8',
              transition: 'width 0.3s ease'
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#6b7280' }}>
          <span>{stats.completed} completed</span>
          <span>•</span>
          <span>{stats.remaining} remaining</span>
          <span>•</span>
          <span>{stats.total} total</span>
        </div>
      </div>

      {/* Goals List */}
      <div className="card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Goals</h3>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowAddForm(true)}
          >
            <Plus size={16} /> Add Goal
          </button>
        </div>

        {/* Add Goal Form */}
        {showAddForm && (
          <div style={{ marginBottom: '16px', padding: '12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="form-control"
                placeholder="Enter your goal for this week..."
                value={newGoalText}
                onChange={(e) => setNewGoalText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddGoal()}
                autoFocus
                style={{ flex: 1 }}
              />
              <button className="btn btn-sm btn-primary" onClick={handleAddGoal}>
                <Save size={14} /> Save
              </button>
              <button className="btn btn-sm" onClick={() => {
                setShowAddForm(false)
                setNewGoalText('')
              }}>
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 12px' }}></div>
            Loading goals…
          </div>
        ) : goals.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
            <Target size={48} style={{ opacity: 0.3, margin: '0 auto 12px' }} />
            <p style={{ margin: '0 0 16px' }}>No goals for this week yet.</p>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddForm(true)}
            >
              <Plus size={16} /> Add Your First Goal
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {goals.map((goal) => (
              <div
                key={goal.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px',
                  background: goal.is_completed ? '#f0fdf4' : 'white',
                  border: '1px solid',
                  borderColor: goal.is_completed ? '#86efac' : '#e5e7eb',
                  borderRadius: '6px',
                  transition: 'all 0.2s'
                }}
              >
                {/* Checkbox */}
                <button
                  onClick={() => handleToggleGoal(goal)}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '6px',
                    border: '2px solid',
                    borderColor: goal.is_completed ? '#16a34a' : '#d1d5db',
                    background: goal.is_completed ? '#16a34a' : 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    flexShrink: 0
                  }}
                >
                  {goal.is_completed && <Check size={16} color="white" strokeWidth={3} />}
                </button>

                {/* Goal Text */}
                {editingId === goal.id ? (
                  <>
                    <input
                      type="text"
                      className="form-control"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdateGoal(goal.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      autoFocus
                      style={{ flex: 1 }}
                    />
                    <button className="btn btn-sm" onClick={() => handleUpdateGoal(goal.id)}>
                      <Save size={14} />
                    </button>
                    <button className="btn btn-sm" onClick={() => setEditingId(null)}>
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <div
                      style={{
                        flex: 1,
                        fontSize: '14px',
                        color: goal.is_completed ? '#16a34a' : '#374151',
                        textDecoration: goal.is_completed ? 'line-through' : 'none',
                        opacity: goal.is_completed ? 0.8 : 1
                      }}
                    >
                      {goal.goal_text}
                    </div>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        setEditingId(goal.id)
                        setEditText(goal.goal_text)
                      }}
                      title="Edit goal"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => handleDeleteGoal(goal.id)}
                      title="Delete goal"
                      style={{ color: '#dc2626' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default MyWeeklyGoals
