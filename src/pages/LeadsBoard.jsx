import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getLeads, moveLead } from '../lib/crm-api'
import { useApp } from '../App'
import LeadCard from '../components/LeadCard'
import LeadForm from './LeadForm'
import { Plus } from 'lucide-react'

const STAGES = [
  { key: 'cold_outreach', label: 'Cold Outreach', color: '#60a5fa' },
  { key: 'warm_lead', label: 'Warm Leads', color: '#fbbf24' },
  { key: 'active_conversation', label: 'Active', color: '#f97316' },
  { key: 'client', label: 'Clients', color: '#22c55e' }
]

function LeadsBoard() {
  const { currentPerson } = useApp()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [draggedLead, setDraggedLead] = useState(null)

  useEffect(() => {
    loadLeads()
  }, [])

  async function loadLeads() {
    setLoading(true)
    try {
      const data = await getLeads()
      setLeads(data)
    } catch (error) {
      console.error('Failed to load leads:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleDragStart(e, lead) {
    setDraggedLead(lead)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  async function handleDrop(e, newStage) {
    e.preventDefault()

    if (!draggedLead || draggedLead.stage === newStage) {
      setDraggedLead(null)
      return
    }

    try {
      await moveLead(draggedLead.id, newStage, currentPerson.id)
      await loadLeads()
    } catch (error) {
      console.error('Failed to move lead:', error)
    } finally {
      setDraggedLead(null)
    }
  }

  function getLeadsByStage(stage) {
    return leads.filter(lead => lead.stage === stage)
  }

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1>Sales Pipeline</h1>
        </div>
        <div className="loading">Loading pipeline...</div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1>Sales Pipeline</h1>
        <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
          <Plus size={18} />
          Add Lead
        </button>
      </div>

      <div className="crm-board">
        {STAGES.map(stage => {
          const stageLeads = getLeadsByStage(stage.key)

          return (
            <div
              key={stage.key}
              className="crm-column"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, stage.key)}
            >
              <div className="crm-column-header" style={{ borderTopColor: stage.color }}>
                <h3>{stage.label}</h3>
                <span className="count-badge" style={{ background: stage.color }}>
                  {stageLeads.length}
                </span>
              </div>

              <div className="crm-column-content">
                {stageLeads.length === 0 && (
                  <div className="empty-column">
                    No leads in this stage
                  </div>
                )}

                {stageLeads.map(lead => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    onDragStart={handleDragStart}
                    onClick={() => navigate(`/crm/leads/${lead.id}`)}
                    onRefresh={loadLeads}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {showAddForm && (
        <LeadForm
          onClose={() => setShowAddForm(false)}
          onSave={() => {
            setShowAddForm(false)
            loadLeads()
          }}
        />
      )}
    </div>
  )
}

export default LeadsBoard
