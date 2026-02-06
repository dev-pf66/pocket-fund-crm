import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getLeads, moveLead } from '../lib/crm-api'
import { useApp } from '../App'
import LeadCard from '../components/LeadCard'
import LeadForm from './LeadForm'
import QuickAddCard from '../components/QuickAddCard'
import { Plus, Search, Filter } from 'lucide-react'

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
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [showFilters, setShowFilters] = useState(false)

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
    return leads.filter(lead => {
      // Stage filter
      if (lead.stage !== stage) return false

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchesName = lead.name?.toLowerCase().includes(query)
        const matchesFirm = lead.firm_name?.toLowerCase().includes(query)
        const matchesEmail = lead.email?.toLowerCase().includes(query)
        if (!matchesName && !matchesFirm && !matchesEmail) return false
      }

      // Type filter
      if (filterType !== 'all') {
        if (filterType === 'needs_samples' && !lead.needs_sample_deals) return false
        if (filterType !== 'needs_samples' && lead.lead_type !== filterType) return false
      }

      return true
    })
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
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-secondary"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter size={18} />
            Filters
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
            <Plus size={18} />
            Add Lead
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="pipeline-controls">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search leads by name, firm, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="clear-search"
              onClick={() => setSearchQuery('')}
            >
              ×
            </button>
          )}
        </div>

        {showFilters && (
          <div className="filter-bar">
            <button
              className={`filter-chip ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
            >
              All
            </button>
            <button
              className={`filter-chip ${filterType === 'PE Firm' ? 'active' : ''}`}
              onClick={() => setFilterType('PE Firm')}
            >
              PE Firms
            </button>
            <button
              className={`filter-chip ${filterType === 'Family Office' ? 'active' : ''}`}
              onClick={() => setFilterType('Family Office')}
            >
              Family Offices
            </button>
            <button
              className={`filter-chip ${filterType === 'Independent Sponsor' ? 'active' : ''}`}
              onClick={() => setFilterType('Independent Sponsor')}
            >
              Independent Sponsors
            </button>
            <button
              className={`filter-chip ${filterType === 'needs_samples' ? 'active' : ''}`}
              onClick={() => setFilterType('needs_samples')}
            >
              📋 Needs Samples
            </button>
          </div>
        )}
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
                <QuickAddCard stage={stage.key} onLeadCreated={loadLeads} />

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
                    onClick={() => navigate(`/leads/${lead.id}`)}
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
