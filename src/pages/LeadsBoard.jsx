import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getLeads, moveLead, getCRMSettings, cachePeek } from '../lib/crm-api'
import { useApp } from '../App'
import LeadCard from '../components/LeadCard'
import LeadForm from './LeadForm'
import QuickAddCard from '../components/QuickAddCard'
import { Plus, Search, Filter, Upload, Save, ChevronDown, X, Bookmark } from 'lucide-react'
import { useSessionState } from '../hooks/useSessionState'
import { useLeadTypes } from '../hooks/useLeadTypes'

const STAGES = [
  { key: 'new_lead', label: 'New Leads', color: '#a78bfa' },
  { key: 'cold_outreach', label: 'Cold Outreach', color: '#60a5fa' },
  { key: 'responded', label: 'Responded', color: '#06b6d4' },
  { key: 'warm_lead', label: 'Warm Leads', color: '#fbbf24' },
  { key: 'active_conversation', label: 'Active', color: '#f97316' },
  { key: 'client', label: 'Clients', color: '#22c55e' }
]

const LEAD_SOURCES = ['LinkedIn', 'Referral', 'Cold Email', 'Event', 'Website']

const ACTIVITY_PRESETS = [
  { value: 'all', label: 'Any Time' },
  { value: '7days', label: 'Last 7 days' },
  { value: '30days', label: 'Last 30 days' },
  { value: 'over30', label: 'Over 30 days ago' },
  { value: 'never', label: 'Never contacted' }
]

const FOLLOWUP_PRESETS = [
  { value: 'all', label: 'Any' },
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'none', label: 'None scheduled' }
]

const SAVED_SEARCHES_KEY = 'pf_crm_saved_searches'

function getDefaultFilters() {
  return {
    searchQuery: '',
    filterType: 'all',
    assignmentFilter: 'all',
    scoreMin: 0,
    scoreMax: 100,
    sourceFilter: 'all',
    activityFilter: 'all',
    followUpFilter: 'all',
    hasLinkedin: 'all'
  }
}

function loadSavedSearches() {
  try {
    const raw = localStorage.getItem(SAVED_SEARCHES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistSavedSearches(searches) {
  localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(searches))
}

function countActiveAdvancedFilters(filters) {
  let count = 0
  if (filters.scoreMin > 0 || filters.scoreMax < 100) count++
  if (filters.sourceFilter !== 'all') count++
  if (filters.activityFilter !== 'all') count++
  if (filters.followUpFilter !== 'all') count++
  if (filters.hasLinkedin !== 'all') count++
  if (filters.filterType !== 'all') count++
  if (filters.assignmentFilter !== 'all') count++
  return count
}

function LeadsBoard() {
  const { currentPerson } = useApp()
  const navigate = useNavigate()
  const leadTypes = useLeadTypes()
  // Seed from cache so sidebar nav back to Pipeline renders instantly.
  const [leads, setLeads] = useState(() => cachePeek('leads:{}') || [])
  const [loading, setLoading] = useState(() => !cachePeek('leads:{}'))
  const [settings, setSettings] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [draggedLead, setDraggedLead] = useState(null)
  const [showFilters, setShowFilters] = useSessionState('lb:showFilters', false)

  // Filter state — persisted to sessionStorage so navigating away and back
  // doesn't reset what the user is looking at.
  const [searchQuery, setSearchQuery] = useSessionState('lb:searchQuery', '')
  const [filterType, setFilterType] = useSessionState('lb:filterType', 'all')
  const [assignmentFilter, setAssignmentFilter] = useSessionState('lb:assignmentFilter', 'all')
  const [scoreMin, setScoreMin] = useSessionState('lb:scoreMin', 0)
  const [scoreMax, setScoreMax] = useSessionState('lb:scoreMax', 100)
  const [sourceFilter, setSourceFilter] = useSessionState('lb:sourceFilter', 'all')
  const [activityFilter, setActivityFilter] = useSessionState('lb:activityFilter', 'all')
  const [followUpFilter, setFollowUpFilter] = useSessionState('lb:followUpFilter', 'all')
  const [hasLinkedin, setHasLinkedin] = useSessionState('lb:hasLinkedin', 'all')

  // Saved searches state
  const [savedSearches, setSavedSearches] = useState(() => loadSavedSearches())
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [searchName, setSearchName] = useState('')
  const [showSavedDropdown, setShowSavedDropdown] = useState(false)

  useEffect(() => {
    loadLeads()
    getCRMSettings().then(setSettings).catch(console.error)
  }, [currentPerson?.id])

  const loadLeads = useCallback(async function loadLeads() {
    if (!currentPerson?.id) return
    try {
      const data = await getLeads({}, currentPerson.id)
      setLeads(data)
    } catch (error) {
      console.error('Failed to load leads:', error)
    } finally {
      setLoading(false)
    }
  }, [currentPerson?.id])

  const handleDragStart = useCallback(function handleDragStart(e, lead) {
    setDraggedLead(lead)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback(function handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

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

  function clearAllFilters() {
    const defaults = getDefaultFilters()
    setSearchQuery(defaults.searchQuery)
    setFilterType(defaults.filterType)
    setAssignmentFilter(defaults.assignmentFilter)
    setScoreMin(defaults.scoreMin)
    setScoreMax(defaults.scoreMax)
    setSourceFilter(defaults.sourceFilter)
    setActivityFilter(defaults.activityFilter)
    setFollowUpFilter(defaults.followUpFilter)
    setHasLinkedin(defaults.hasLinkedin)
  }

  function getCurrentFilters() {
    return {
      searchQuery,
      filterType,
      assignmentFilter,
      scoreMin,
      scoreMax,
      sourceFilter,
      activityFilter,
      followUpFilter,
      hasLinkedin
    }
  }

  function applyFilters(filters) {
    setSearchQuery(filters.searchQuery || '')
    setFilterType(filters.filterType || 'all')
    setAssignmentFilter(filters.assignmentFilter || 'all')
    setScoreMin(filters.scoreMin ?? 0)
    setScoreMax(filters.scoreMax ?? 100)
    setSourceFilter(filters.sourceFilter || 'all')
    setActivityFilter(filters.activityFilter || 'all')
    setFollowUpFilter(filters.followUpFilter || 'all')
    setHasLinkedin(filters.hasLinkedin || 'all')
    setShowFilters(true)
  }

  function handleSaveSearch() {
    if (!searchName.trim()) return
    const entry = {
      name: searchName.trim(),
      filters: getCurrentFilters(),
      createdAt: new Date().toISOString()
    }
    const updated = [...savedSearches, entry]
    setSavedSearches(updated)
    persistSavedSearches(updated)
    setSearchName('')
    setShowSaveDialog(false)
  }

  function handleDeleteSavedSearch(index) {
    const updated = savedSearches.filter((_, i) => i !== index)
    setSavedSearches(updated)
    persistSavedSearches(updated)
  }

  function handleLoadSavedSearch(entry) {
    applyFilters(entry.filters)
    setShowSavedDropdown(false)
  }

  const activeFilterCount = countActiveAdvancedFilters(getCurrentFilters())

  const leadsByStage = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const result = {}

    for (const stage of STAGES) {
      result[stage.key] = []
    }

    const queryLower = searchQuery ? searchQuery.toLowerCase() : ''

    for (const lead of leads) {
      if (!result[lead.stage]) continue

      // Search filter
      if (queryLower) {
        const matchesName = lead.name?.toLowerCase().includes(queryLower)
        const matchesFirm = lead.firm_name?.toLowerCase().includes(queryLower)
        const matchesEmail = lead.email?.toLowerCase().includes(queryLower)
        if (!matchesName && !matchesFirm && !matchesEmail) continue
      }

      // Assignment filter
      if (assignmentFilter === 'mine' && lead.assigned_to !== currentPerson?.id) continue
      if (assignmentFilter === 'unassigned' && lead.assigned_to != null) continue

      // Type filter
      if (filterType !== 'all') {
        if (filterType === 'needs_samples' && !lead.needs_sample_deals) continue
        if (filterType !== 'needs_samples' && lead.lead_type !== filterType) continue
      }

      // Lead score range
      if (scoreMin > 0 || scoreMax < 100) {
        const score = lead.lead_score ?? 0
        if (score < scoreMin || score > scoreMax) continue
      }

      // Source filter
      if (sourceFilter !== 'all') {
        if ((lead.lead_source || '').toLowerCase() !== sourceFilter.toLowerCase()) continue
      }

      // Last activity filter
      if (activityFilter !== 'all') {
        const lastActivity = lead.last_activity_date ? new Date(lead.last_activity_date) : null
        if (activityFilter === 'never') {
          if (lastActivity) continue
        } else if (activityFilter === '7days') {
          if (!lastActivity) continue
          if ((now - lastActivity) / (1000 * 60 * 60 * 24) > 7) continue
        } else if (activityFilter === '30days') {
          if (!lastActivity) continue
          if ((now - lastActivity) / (1000 * 60 * 60 * 24) > 30) continue
        } else if (activityFilter === 'over30') {
          if (!lastActivity) continue
          if ((now - lastActivity) / (1000 * 60 * 60 * 24) <= 30) continue
        }
      }

      // Follow-up filter
      if (followUpFilter !== 'all') {
        const followUp = lead.next_follow_up_date ? new Date(lead.next_follow_up_date) : null
        if (followUpFilter === 'none') {
          if (followUp) continue
        } else if (followUpFilter === 'today') {
          if (!followUp) continue
          const fDate = new Date(followUp.getFullYear(), followUp.getMonth(), followUp.getDate())
          if (fDate.getTime() !== today.getTime()) continue
        } else if (followUpFilter === 'this_week') {
          if (!followUp) continue
          const endOfWeek = new Date(today)
          endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()))
          if (followUp < today || followUp > endOfWeek) continue
        } else if (followUpFilter === 'overdue') {
          if (!followUp) continue
          if (followUp >= today) continue
        }
      }

      // Has LinkedIn URL
      if (hasLinkedin !== 'all') {
        const hasUrl = !!lead.linkedin_url
        if (hasLinkedin === 'yes' && !hasUrl) continue
        if (hasLinkedin === 'no' && hasUrl) continue
      }

      result[lead.stage].push(lead)
    }

    return result
  }, [leads, searchQuery, assignmentFilter, currentPerson?.id, filterType, scoreMin, scoreMax, sourceFilter, activityFilter, followUpFilter, hasLinkedin])

  if (loading && leads.length === 0) {
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
            {activeFilterCount > 0 && (
              <span className="filter-count-badge">{activeFilterCount}</span>
            )}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => navigate('/import')}
          >
            <Upload size={18} />
            Import CSV
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
            <Plus size={18} />
            Add Lead
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="pipeline-controls">
        <div className="saved-search-bar">
          <div className="search-box" style={{ marginBottom: 0, flex: 1 }}>
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

          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setShowSavedDropdown(!showSavedDropdown)}
              title="Saved searches"
            >
              <Bookmark size={16} />
              Saved
              <ChevronDown size={14} />
            </button>
            {showSavedDropdown && (
              <div className="saved-search-dropdown">
                {savedSearches.length === 0 ? (
                  <div className="saved-search-empty">No saved searches yet</div>
                ) : (
                  savedSearches.map((entry, i) => (
                    <div key={i} className="saved-search-item">
                      <button
                        className="saved-search-load"
                        onClick={() => handleLoadSavedSearch(entry)}
                      >
                        {entry.name}
                      </button>
                      <button
                        className="saved-search-delete"
                        onClick={() => handleDeleteSavedSearch(i)}
                        title="Delete"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <button
            className="btn btn-secondary"
            onClick={() => setShowSaveDialog(true)}
            title="Save current search"
          >
            <Save size={16} />
            Save Search
          </button>
        </div>

        {showFilters && (
          <>
            <div className="filter-bar">
              <div style={{ display: 'flex', gap: '8px', marginRight: '16px', paddingRight: '16px', borderRight: '2px solid var(--gray-200)' }}>
                <button
                  className={`filter-chip ${assignmentFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setAssignmentFilter('all')}
                >
                  All Leads
                </button>
                <button
                  className={`filter-chip ${assignmentFilter === 'mine' ? 'active' : ''}`}
                  onClick={() => setAssignmentFilter('mine')}
                >
                  My Leads
                </button>
                <button
                  className={`filter-chip ${assignmentFilter === 'unassigned' ? 'active' : ''}`}
                  onClick={() => setAssignmentFilter('unassigned')}
                >
                  Unassigned
                </button>
              </div>

              <button
                className={`filter-chip ${filterType === 'all' ? 'active' : ''}`}
                onClick={() => setFilterType('all')}
              >
                All Types
              </button>
              {leadTypes.map(t => (
                <button
                  key={t.id}
                  className={`filter-chip ${filterType === t.name ? 'active' : ''}`}
                  onClick={() => setFilterType(t.name)}
                >
                  {t.name}
                </button>
              ))}
              <button
                className={`filter-chip ${filterType === 'needs_samples' ? 'active' : ''}`}
                onClick={() => setFilterType('needs_samples')}
              >
                Needs Samples
              </button>
            </div>

            <div className="advanced-filters">
              <div className="advanced-filters-grid">
                {/* Lead Score Range */}
                <div className="advanced-filter-group">
                  <label className="advanced-filter-label">Lead Score</label>
                  <div className="filter-range-input">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={scoreMin}
                      onChange={(e) => setScoreMin(Math.max(0, Math.min(100, Number(e.target.value))))}
                      placeholder="Min"
                    />
                    <span className="range-separator">-</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={scoreMax}
                      onChange={(e) => setScoreMax(Math.max(0, Math.min(100, Number(e.target.value))))}
                      placeholder="Max"
                    />
                  </div>
                </div>

                {/* Lead Source */}
                <div className="advanced-filter-group">
                  <label className="advanced-filter-label">Lead Source</label>
                  <select
                    className="advanced-filter-select"
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                  >
                    <option value="all">All Sources</option>
                    {LEAD_SOURCES.map(src => (
                      <option key={src} value={src}>{src}</option>
                    ))}
                  </select>
                </div>

                {/* Last Activity */}
                <div className="advanced-filter-group">
                  <label className="advanced-filter-label">Last Activity</label>
                  <select
                    className="advanced-filter-select"
                    value={activityFilter}
                    onChange={(e) => setActivityFilter(e.target.value)}
                  >
                    {ACTIVITY_PRESETS.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>

                {/* Follow-up Due */}
                <div className="advanced-filter-group">
                  <label className="advanced-filter-label">Follow-up Due</label>
                  <select
                    className="advanced-filter-select"
                    value={followUpFilter}
                    onChange={(e) => setFollowUpFilter(e.target.value)}
                  >
                    {FOLLOWUP_PRESETS.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>

                {/* Has LinkedIn URL */}
                <div className="advanced-filter-group">
                  <label className="advanced-filter-label">Has LinkedIn</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      className={`filter-chip small ${hasLinkedin === 'all' ? 'active' : ''}`}
                      onClick={() => setHasLinkedin('all')}
                    >
                      Any
                    </button>
                    <button
                      className={`filter-chip small ${hasLinkedin === 'yes' ? 'active' : ''}`}
                      onClick={() => setHasLinkedin('yes')}
                    >
                      Yes
                    </button>
                    <button
                      className={`filter-chip small ${hasLinkedin === 'no' ? 'active' : ''}`}
                      onClick={() => setHasLinkedin('no')}
                    >
                      No
                    </button>
                  </div>
                </div>
              </div>

              {activeFilterCount > 0 && (
                <button className="clear-all-filters" onClick={clearAllFilters}>
                  <X size={14} />
                  Clear All Filters
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="crm-board">
        {STAGES.map(stage => {
          const stageLeads = leadsByStage[stage.key] || []

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
                    settings={settings}
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

      {/* Save Search Dialog */}
      {showSaveDialog && (
        <div className="save-search-dialog-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="save-search-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Save Current Search</h3>
            <p style={{ fontSize: '13px', color: 'var(--gray-500)', marginBottom: '12px' }}>
              Save your current filters to quickly reuse them later.
            </p>
            <input
              type="text"
              className="save-search-input"
              placeholder="Enter a name for this search..."
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveSearch()}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowSaveDialog(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveSearch}
                disabled={!searchName.trim()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default LeadsBoard
