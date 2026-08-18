import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getLeads, moveLead, updateLead, getCRMSettings, cachePeek, getDemoLeadIds, getLeadLatestOutreachStatus } from '../lib/crm-api'
import { useApp } from '../App'
import { useToast } from '../components/Toast'
import LeadCard from '../components/LeadCard'
import LeadForm from './LeadForm'
import QuickAddCard from '../components/QuickAddCard'
import { Plus, Search, Filter, Upload, Save, ChevronDown, X, Bookmark, XCircle } from 'lucide-react'
import { useSessionState } from '../hooks/useSessionState'
import { useLeadTypes } from '../hooks/useLeadTypes'
import { isAdminUser } from '../lib/admin'
import { runBulk } from '../lib/bulkActions'

const STAGES = [
  { key: 'new_lead', label: 'New Leads', color: '#a78bfa' },
  { key: 'cold_outreach', label: 'Cold Outreach', color: '#60a5fa' },
  { key: 'responded', label: 'Responded', color: '#06b6d4' },
  { key: 'warm_lead', label: 'Warm Leads', color: '#fbbf24' },
  { key: 'active_conversation', label: 'Active', color: '#f97316' },
  { key: 'meeting_booked', label: 'Meeting', color: '#ec4899' },
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

// Inline styles for the Sales Pipeline filter sections — keeps the markup
// declarative and avoids piling onto the global CSS.
const filterSectionStyle = {
  marginBottom: '14px'
}

const filterSectionLabelStyle = {
  fontSize: '11px',
  fontWeight: 700,
  color: '#9ca3af',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: '8px'
}

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
    hasLinkedin: 'all',
    analystFilter: 'all',
    responseFilter: 'all',
    createdFilter: 'all',
    hasEmail: 'all',
    hasPhone: 'all'
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
  if (filters.analystFilter && filters.analystFilter !== 'all') count++
  if (filters.responseFilter && filters.responseFilter !== 'all') count++
  if (filters.createdFilter && filters.createdFilter !== 'all') count++
  if (filters.hasEmail && filters.hasEmail !== 'all') count++
  if (filters.hasPhone && filters.hasPhone !== 'all') count++
  return count
}

function LeadsBoard() {
  const { currentPerson, people } = useApp()
  const { toast } = useToast()
  const navigate = useNavigate()
  const leadTypes = useLeadTypes()
  const isAdmin = isAdminUser(currentPerson)
  // Admins load the whole team's leads (getLeads with null personId, which
  // RLS lets admins through); non-admins are scoped to their own.
  const leadScopeId = isAdmin ? null : (currentPerson?.id ?? null)
  const seedKey = 'leads:' + (leadScopeId ?? 'all') + ':{}'
  // Seed from cache so sidebar nav back to Pipeline renders instantly.
  const [leads, setLeads] = useState(() => cachePeek(seedKey) || [])
  const [loading, setLoading] = useState(() => !cachePeek(seedKey))
  // Lead IDs that show up in any PE OS demo. Drives the "PE OS" filter pill.
  const [demoLeadIds, setDemoLeadIds] = useState(() => new Set())
  // Map<lead_id, latest_outreach_status>. Drives the response-status filter.
  const [responseStatusByLead, setResponseStatusByLead] = useState(() => new Map())
  const [settings, setSettings] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [draggedLead, setDraggedLead] = useState(null)
  const [showFilters, setShowFilters] = useSessionState('lb:showFilters', false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkAssignee, setBulkAssignee] = useState('')
  const [bulkStage, setBulkStage] = useState('')

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
  // New filters: specific analyst (assigned_to id as string), latest outreach
  // response, created-within window, has-email/phone toggles.
  const [analystFilter, setAnalystFilter] = useSessionState('lb:analystFilter', 'all')
  const [responseFilter, setResponseFilter] = useSessionState('lb:responseFilter', 'all')
  const [createdFilter, setCreatedFilter] = useSessionState('lb:createdFilter', 'all')
  const [hasEmail, setHasEmail] = useSessionState('lb:hasEmail', 'all')
  const [hasPhone, setHasPhone] = useSessionState('lb:hasPhone', 'all')

  // Saved searches state
  const [savedSearches, setSavedSearches] = useState(() => loadSavedSearches())
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [searchName, setSearchName] = useState('')
  const [showSavedDropdown, setShowSavedDropdown] = useState(false)

  useEffect(() => {
    loadLeads()
    getCRMSettings().then(setSettings).catch(console.error)
  }, [currentPerson?.id, isAdmin])

  const loadLeads = useCallback(async function loadLeads() {
    if (!currentPerson?.id) return
    try {
      // Admins pull everything (leadScopeId null); non-admins pull their own.
      const [data, demoIds, statusMap] = await Promise.all([
        getLeads({}, leadScopeId),
        getDemoLeadIds(leadScopeId).catch(() => new Set()),
        getLeadLatestOutreachStatus(leadScopeId).catch(() => new Map())
      ])
      setLeads(data)
      setDemoLeadIds(demoIds)
      setResponseStatusByLead(statusMap)
    } catch (error) {
      console.error('Failed to load leads:', error)
    } finally {
      setLoading(false)
    }
  }, [currentPerson?.id, leadScopeId])

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
    setAnalystFilter(defaults.analystFilter)
    setResponseFilter(defaults.responseFilter)
    setCreatedFilter(defaults.createdFilter)
    setHasEmail(defaults.hasEmail)
    setHasPhone(defaults.hasPhone)
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
      hasLinkedin,
      analystFilter,
      responseFilter,
      createdFilter,
      hasEmail,
      hasPhone
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
    setAnalystFilter(filters.analystFilter || 'all')
    setResponseFilter(filters.responseFilter || 'all')
    setCreatedFilter(filters.createdFilter || 'all')
    setHasEmail(filters.hasEmail || 'all')
    setHasPhone(filters.hasPhone || 'all')
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

      // Analyst filter (specific person — admins use this to drill into a
      // teammate's book, separate from the My/Unassigned chips above).
      if (analystFilter !== 'all') {
        if (String(lead.assigned_to ?? '') !== String(analystFilter)) continue
      }

      // Latest outreach response. 'never_contacted' = no entry in the map.
      if (responseFilter !== 'all') {
        const latest = responseStatusByLead.get(lead.id)
        if (responseFilter === 'never_contacted') {
          if (latest) continue
        } else {
          if (latest !== responseFilter) continue
        }
      }

      // Created-within window relative to today.
      if (createdFilter !== 'all' && lead.created_at) {
        const created = new Date(lead.created_at)
        const days = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24))
        if (createdFilter === '7d' && days > 7) continue
        if (createdFilter === '30d' && days > 30) continue
        if (createdFilter === '90d' && days > 90) continue
        if (createdFilter === 'this_month') {
          const now = new Date()
          if (created.getFullYear() !== now.getFullYear() || created.getMonth() !== now.getMonth()) continue
        }
      }

      // Has-email / has-phone toggles (mirror hasLinkedin).
      if (hasEmail === 'yes' && !lead.email) continue
      if (hasEmail === 'no' && lead.email) continue
      if (hasPhone === 'yes' && !lead.phone) continue
      if (hasPhone === 'no' && lead.phone) continue

      // Type filter
      if (filterType !== 'all') {
        if (filterType === 'needs_samples') {
          if (!lead.needs_sample_deals) continue
        } else if (filterType === 'has_demo') {
          // "PE OS" pill: keep only leads that appear in at least one demo.
          if (!demoLeadIds.has(lead.id)) continue
        } else {
          if (lead.lead_type !== filterType) continue
        }
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
  }, [leads, searchQuery, assignmentFilter, currentPerson?.id, filterType, scoreMin, scoreMax, sourceFilter, activityFilter, followUpFilter, hasLinkedin, demoLeadIds, analystFilter, responseFilter, createdFilter, hasEmail, hasPhone, responseStatusByLead])

  const filteredLeadCount = useMemo(
    () => Object.values(leadsByStage).reduce((sum, list) => sum + list.length, 0),
    [leadsByStage]
  )

  const visibleLeads = useMemo(
    () => Object.values(leadsByStage).flat(),
    [leadsByStage]
  )
  const visibleLeadIds = useMemo(() => visibleLeads.map(l => l.id), [visibleLeads])

  // Drop any selected id that's scrolled out of the filtered/visible set.
  useEffect(() => {
    const visible = new Set(visibleLeadIds)
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [visibleLeadIds])

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(prev => {
      const allSelected = visibleLeadIds.length > 0 && visibleLeadIds.every(id => prev.has(id))
      return allSelected ? new Set() : new Set(visibleLeadIds)
    })
  }

  async function handleBulkReassign() {
    if (!selectedIds.size || !bulkAssignee) return
    setBulkBusy(true)
    try {
      const targets = visibleLeads.filter(l => selectedIds.has(l.id))
      const { succeeded, failed } = await runBulk(targets, lead =>
        updateLead(lead.id, { assigned_to: parseInt(bulkAssignee, 10), assigned_by: currentPerson.id }, currentPerson.id)
      )
      toast.success(`Reassigned ${succeeded.length} lead${succeeded.length === 1 ? '' : 's'}`)
      if (failed.length) toast.error(`${failed.length} failed to reassign`)
      setSelectedIds(new Set())
      setBulkAssignee('')
      await loadLeads()
    } catch (error) {
      console.error('Bulk reassign failed:', error)
      toast.error('Bulk reassign failed: ' + error.message)
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleBulkStageMove() {
    if (!selectedIds.size || !bulkStage) return
    setBulkBusy(true)
    try {
      const targets = visibleLeads.filter(l => selectedIds.has(l.id))
      const { succeeded, failed } = await runBulk(targets, lead => moveLead(lead.id, bulkStage, currentPerson.id))
      toast.success(`Moved ${succeeded.length} lead${succeeded.length === 1 ? '' : 's'}`)
      if (failed.length) toast.error(`${failed.length} failed to move`)
      setSelectedIds(new Set())
      setBulkStage('')
      await loadLeads()
    } catch (error) {
      console.error('Bulk stage move failed:', error)
      toast.error('Bulk move failed: ' + error.message)
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleBulkMarkDead() {
    if (!selectedIds.size) return
    if (!confirm(`Mark ${selectedIds.size} lead${selectedIds.size === 1 ? '' : 's'} as dead (stage → Passed)?`)) return
    setBulkBusy(true)
    try {
      const targets = visibleLeads.filter(l => selectedIds.has(l.id))
      const { succeeded, failed } = await runBulk(targets, lead => updateLead(lead.id, { stage: 'passed' }, currentPerson.id))
      toast.success(`Marked ${succeeded.length} lead${succeeded.length === 1 ? '' : 's'} dead`)
      if (failed.length) toast.error(`${failed.length} failed to update`)
      setSelectedIds(new Set())
      await loadLeads()
    } catch (error) {
      console.error('Bulk dismiss failed:', error)
      toast.error('Bulk dismiss failed: ' + error.message)
    } finally {
      setBulkBusy(false)
    }
  }

  if (loading && leads.length === 0) {
    return (
      <div>
        <div className="page-header">
          <h1>Pipeline</h1>
        </div>
        <div className="loading">Loading pipeline...</div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1>Pipeline</h1>
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
              {leadTypes
                // The PE OS function pill below filters by demo presence; hide
                // any "PE OS" lead-type entry (left over in crm_field_options
                // from before the kanban existed) so we don't render two pills
                // with the same label.
                .filter(t => (t.name || '').toLowerCase() !== 'pe os')
                .map(t => (
                  <button
                    key={t.id}
                    className={`filter-chip ${filterType === t.name ? 'active' : ''}`}
                    onClick={() => setFilterType(t.name)}
                  >
                    {t.name}
                  </button>
                ))}
              <button
                className={`filter-chip ${filterType === 'has_demo' ? 'active' : ''}`}
                onClick={() => setFilterType('has_demo')}
                title="Leads that have at least one PE OS demo"
              >
                PE OS
              </button>
              <button
                className={`filter-chip ${filterType === 'needs_samples' ? 'active' : ''}`}
                onClick={() => setFilterType('needs_samples')}
              >
                Needs Samples
              </button>
            </div>

            <div className="advanced-filters">
              {/* Person */}
              <div style={filterSectionStyle}>
                <div style={filterSectionLabelStyle}>Person</div>
                <div className="advanced-filters-grid">
                  <div className="advanced-filter-group">
                    <label className="advanced-filter-label">Analyst</label>
                    <select
                      className="advanced-filter-select"
                      value={analystFilter}
                      onChange={(e) => setAnalystFilter(e.target.value)}
                    >
                      <option value="all">Any analyst</option>
                      {(people || []).map(p => (
                        <option key={p.id} value={String(p.id)}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Activity & status */}
              <div style={filterSectionStyle}>
                <div style={filterSectionLabelStyle}>Activity &amp; Status</div>
                <div className="advanced-filters-grid">
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

                  <div className="advanced-filter-group">
                    <label className="advanced-filter-label">Outreach Response</label>
                    <select
                      className="advanced-filter-select"
                      value={responseFilter}
                      onChange={(e) => setResponseFilter(e.target.value)}
                    >
                      <option value="all">Any</option>
                      <option value="replied">Replied</option>
                      <option value="sent">Sent (no reply yet)</option>
                      <option value="no_response">No response</option>
                      <option value="bounced">Bounced</option>
                      <option value="never_contacted">Never contacted</option>
                    </select>
                  </div>

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
                </div>
              </div>

              {/* Lead info */}
              <div style={filterSectionStyle}>
                <div style={filterSectionLabelStyle}>Lead Info</div>
                <div className="advanced-filters-grid">
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

                  <div className="advanced-filter-group">
                    <label className="advanced-filter-label">Added</label>
                    <select
                      className="advanced-filter-select"
                      value={createdFilter}
                      onChange={(e) => setCreatedFilter(e.target.value)}
                    >
                      <option value="all">Any time</option>
                      <option value="7d">Last 7 days</option>
                      <option value="30d">Last 30 days</option>
                      <option value="90d">Last 90 days</option>
                      <option value="this_month">This month</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Contact info */}
              <div style={filterSectionStyle}>
                <div style={filterSectionLabelStyle}>Contact Info</div>
                <div className="advanced-filters-grid">
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

                  <div className="advanced-filter-group">
                    <label className="advanced-filter-label">Has Email</label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className={`filter-chip small ${hasEmail === 'all' ? 'active' : ''}`} onClick={() => setHasEmail('all')}>Any</button>
                      <button className={`filter-chip small ${hasEmail === 'yes' ? 'active' : ''}`} onClick={() => setHasEmail('yes')}>Yes</button>
                      <button className={`filter-chip small ${hasEmail === 'no' ? 'active' : ''}`} onClick={() => setHasEmail('no')}>No</button>
                    </div>
                  </div>

                  <div className="advanced-filter-group">
                    <label className="advanced-filter-label">Has Phone</label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className={`filter-chip small ${hasPhone === 'all' ? 'active' : ''}`} onClick={() => setHasPhone('all')}>Any</button>
                      <button className={`filter-chip small ${hasPhone === 'yes' ? 'active' : ''}`} onClick={() => setHasPhone('yes')}>Yes</button>
                      <button className={`filter-chip small ${hasPhone === 'no' ? 'active' : ''}`} onClick={() => setHasPhone('no')}>No</button>
                    </div>
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

      {/* Floating results bar — surfaces how filtered the view is and
          gives a one-click clear without reopening the panel. Hidden when
          there's nothing useful to say (no filters AND no leads loaded). */}
      {(activeFilterCount > 0 || searchQuery || (leads.length > 0)) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            padding: '8px 14px',
            margin: '0 0 12px',
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            fontSize: '13px',
            color: '#4b5563'
          }}
        >
          <span>
            <strong style={{ color: '#111827', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {filteredLeadCount}
            </strong>
            {' of '}
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{leads.length}</span>
            {' lead'}{leads.length === 1 ? '' : 's'}{' shown'}
          </span>
          {(activeFilterCount > 0 || searchQuery) && (
            <span style={{
              fontSize: '11px', fontWeight: 600,
              padding: '2px 8px', borderRadius: '999px',
              background: '#eff6ff', color: '#1d4ed8'
            }}>
              {activeFilterCount + (searchQuery ? 1 : 0)} filter{(activeFilterCount + (searchQuery ? 1 : 0)) === 1 ? '' : 's'} active
            </span>
          )}
          <button
            className="btn btn-sm btn-secondary"
            style={{ marginLeft: (activeFilterCount > 0 || searchQuery) ? 0 : 'auto' }}
            onClick={toggleSelectAll}
            disabled={visibleLeadIds.length === 0}
          >
            {visibleLeadIds.length > 0 && visibleLeadIds.every(id => selectedIds.has(id)) ? 'Deselect all' : 'Select all shown'}
          </button>
          {(activeFilterCount > 0 || searchQuery) && (
            <button
              onClick={() => { setSearchQuery(''); clearAllFilters() }}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: 'none',
                color: '#1d4ed8',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '2px 6px'
              }}
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div
          className="card"
          style={{
            padding: '10px 16px', marginBottom: '12px', display: 'flex',
            alignItems: 'center', justifyContent: 'space-between', gap: '12px',
            flexWrap: 'wrap', background: '#eff6ff', border: '1px solid #bfdbfe',
            position: 'sticky', top: '8px', zIndex: 5
          }}
        >
          <span style={{ fontSize: '14px', color: '#1e3a8a', fontWeight: 500 }}>
            {selectedIds.size} lead{selectedIds.size === 1 ? '' : 's'} selected
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <select value={bulkAssignee} onChange={(e) => setBulkAssignee(e.target.value)} className="form-select" disabled={bulkBusy}>
              <option value="">Reassign to…</option>
              {(people || []).map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
            <button className="btn btn-sm btn-primary" onClick={handleBulkReassign} disabled={bulkBusy || !bulkAssignee}>
              Apply
            </button>
            <select value={bulkStage} onChange={(e) => setBulkStage(e.target.value)} className="form-select" disabled={bulkBusy}>
              <option value="">Move to stage…</option>
              {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button className="btn btn-sm btn-primary" onClick={handleBulkStageMove} disabled={bulkBusy || !bulkStage}>
              Apply
            </button>
            <button className="btn btn-sm btn-secondary" onClick={handleBulkMarkDead} disabled={bulkBusy} style={{ color: '#b91c1c' }}>
              <XCircle size={14} /> Mark dead
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => setSelectedIds(new Set())} disabled={bulkBusy}>
              Clear
            </button>
          </div>
        </div>
      )}

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
                    latestOutreachStatus={responseStatusByLead.get(lead.id)}
                    onDragStart={handleDragStart}
                    onClick={() => navigate(`/leads/${lead.id}`)}
                    onRefresh={loadLeads}
                    selected={selectedIds.has(lead.id)}
                    onToggleSelect={() => toggleSelect(lead.id)}
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
