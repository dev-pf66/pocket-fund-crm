import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getAllOutreachLogs, updateOutreach } from '../lib/crm-api'
import { Target, ChevronDown, ChevronUp, Filter, Check } from 'lucide-react'
import { useToast } from '../components/Toast'
import { useSessionState } from '../hooks/useSessionState'

// Keys MUST match the values written by OutreachTracker's form + quick-log
// and by markLeadReachedOut — otherwise the badge shows the raw enum and
// the filter dropdown returns zero results.
const PLATFORM_LABELS = {
  cold_email: 'Email',
  linkedin_message: 'LinkedIn',
  phone_call: 'Phone',
  other: 'Other'
}

const PLATFORMS = ['cold_email', 'linkedin_message', 'phone_call', 'other']

function FitStars({ score }) {
  if (!score) return <span style={{ color: '#9ca3af', fontSize: '13px' }}>—</span>
  return (
    <span>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ color: i < score ? '#f59e0b' : '#d1d5db', fontSize: '14px' }}>★</span>
      ))}
    </span>
  )
}

function OutreachAdmin() {
  const { toast } = useToast()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useSessionState('oa:expandedId', null)
  const [togglingId, setTogglingId] = useState(null)

  const [filters, setFilters] = useSessionState('oa:filters', {
    platform: '',
    days_back: '',
    has_response: '',
    logged_by: ''
  })

  useEffect(() => {
    loadData()
  }, [filters])

  async function loadData() {
    setLoading(true)
    try {
      const applied = {}
      if (filters.platform) applied.platform = filters.platform
      if (filters.days_back) applied.days_back = parseInt(filters.days_back)
      if (filters.has_response === 'yes') applied.has_response = true
      if (filters.has_response === 'no') applied.has_response = false

      const data = await getAllOutreachLogs(applied)
      setEntries(data)
    } catch (err) {
      console.error('Failed to load outreach logs:', err)
    } finally {
      setLoading(false)
    }
  }

  function toggleExpand(id) {
    setExpandedId(prev => prev === id ? null : id)
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    })
  }

  // Team breakdown is always computed across everyone matching the server
  // filters, so clicking a person card narrows the table without making the
  // other people disappear from the panel.
  const teamStats = (() => {
    const byPerson = new Map()
    for (const e of entries) {
      const id = e.logged_by ?? 'unassigned'
      const name = e.logged_by_person?.name || 'Unassigned'
      if (!byPerson.has(id)) byPerson.set(id, { id, name, total: 0, replied: 0 })
      const s = byPerson.get(id)
      s.total += 1
      if (e.status === 'replied') s.replied += 1
    }
    return Array.from(byPerson.values()).sort((a, b) => b.total - a.total)
  })()

  const visibleEntries = filters.logged_by
    ? entries.filter(e => String(e.logged_by ?? 'unassigned') === String(filters.logged_by))
    : entries

  const totalCount = visibleEntries.length
  const withResponse = visibleEntries.filter(e => e.status === 'replied').length

  async function toggleResponded(entry, e) {
    e.stopPropagation()
    const next = entry.status === 'replied' ? 'sent' : 'replied'
    setTogglingId(entry.id)
    try {
      await updateOutreach(entry.id, { status: next })
      setEntries(prev => prev.map(x => x.id === entry.id ? { ...x, status: next } : x))
      toast.success(next === 'replied' ? 'Marked as responded' : 'Marked as no response')
    } catch (err) {
      console.error('Failed to toggle status:', err)
      toast.error('Failed to update status')
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
            <Target size={24} /> Outreach Log
          </h1>
          <p style={{ color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
            All outreach activity across the team
          </p>
        </div>
      </div>

      {/* Summary Banner */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1', minWidth: '150px', padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#1d4ed8' }}>{totalCount}</div>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>Total Outreach</div>
        </div>
        <div className="card" style={{ flex: '1', minWidth: '150px', padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#15803d' }}>{withResponse}</div>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>Got Response</div>
        </div>
        <div className="card" style={{ flex: '1', minWidth: '150px', padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#92400e' }}>
            {totalCount > 0 ? Math.round((withResponse / totalCount) * 100) : 0}%
          </div>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>Response Rate</div>
        </div>
      </div>

      {/* By Team Member */}
      {!loading && teamStats.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            By Team Member
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {teamStats.map(p => {
              const rate = p.total > 0 ? Math.round((p.replied / p.total) * 100) : 0
              const isActive = String(filters.logged_by) === String(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => setFilters(f => ({ ...f, logged_by: isActive ? '' : String(p.id) }))}
                  className="card"
                  style={{
                    padding: '12px 16px',
                    minWidth: '170px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: isActive ? '2px solid #1d4ed8' : '1px solid #e5e7eb',
                    background: isActive ? '#eff6ff' : 'white'
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '6px' }}>
                    {p.name}
                  </div>
                  <div style={{ display: 'flex', gap: '14px', fontSize: '12px', color: '#6b7280' }}>
                    <span><strong style={{ color: '#1d4ed8' }}>{p.total}</strong> sent</span>
                    <span><strong style={{ color: '#15803d' }}>{p.replied}</strong> replied</span>
                    <span><strong style={{ color: '#92400e' }}>{rate}%</strong></span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Filter size={16} style={{ color: '#6b7280' }} />

          <select
            value={filters.logged_by}
            onChange={e => setFilters(f => ({ ...f, logged_by: e.target.value }))}
            className="form-control"
            style={{ width: 'auto', fontSize: '13px' }}
          >
            <option value="">All Team Members</option>
            {teamStats.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <select
            value={filters.platform}
            onChange={e => setFilters(f => ({ ...f, platform: e.target.value }))}
            className="form-control"
            style={{ width: 'auto', fontSize: '13px' }}
          >
            <option value="">All Platforms</option>
            {PLATFORMS.map(p => (
              <option key={p} value={p}>{PLATFORM_LABELS[p] || p}</option>
            ))}
          </select>

          <select
            value={filters.days_back}
            onChange={e => setFilters(f => ({ ...f, days_back: e.target.value }))}
            className="form-control"
            style={{ width: 'auto', fontSize: '13px' }}
          >
            <option value="">All Time</option>
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>

          <select
            value={filters.has_response}
            onChange={e => setFilters(f => ({ ...f, has_response: e.target.value }))}
            className="form-control"
            style={{ width: 'auto', fontSize: '13px' }}
          >
            <option value="">All (response or not)</option>
            <option value="yes">Got response</option>
            <option value="no">No response</option>
          </select>

          {(filters.platform || filters.days_back || filters.has_response || filters.logged_by) && (
            <button
              className="btn btn-sm"
              onClick={() => setFilters({ platform: '', days_back: '', has_response: '', logged_by: '' })}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 12px' }}></div>
            Loading outreach logs…
          </div>
        ) : visibleEntries.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
            No outreach entries found.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Lead (Company)</th>
                <th style={thStyle}>Platform</th>
                <th style={thStyle}>Logged By</th>
                <th style={thStyle}>Message Preview</th>
                <th style={thStyle}>Fit</th>
                <th style={thStyle}>Response?</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map(entry => (
                <>
                  <tr
                    key={entry.id}
                    style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                    onClick={() => toggleExpand(entry.id)}
                  >
                    <td style={tdStyle}>{formatDate(entry.outreach_date)}</td>
                    <td style={tdStyle}>
                      {entry.lead ? (
                        <Link
                          to={`/leads/${entry.lead.id}`}
                          onClick={e => e.stopPropagation()}
                          style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: '500' }}
                        >
                          {entry.lead_name || entry.lead.name}
                          {(entry.firm_name || entry.lead.firm_name) && (
                            <span style={{ display: 'block', fontSize: '12px', color: '#6b7280', fontWeight: '400' }}>
                              {entry.firm_name || entry.lead.firm_name}
                            </span>
                          )}
                        </Link>
                      ) : (
                        <span>
                          {entry.lead_name}
                          {entry.firm_name && (
                            <span style={{ display: 'block', fontSize: '12px', color: '#6b7280' }}>
                              {entry.firm_name}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span className="badge badge-secondary" style={{ fontSize: '11px' }}>
                        {PLATFORM_LABELS[entry.outreach_type] || entry.outreach_type || '—'}
                      </span>
                    </td>
                    <td style={tdStyle}>{entry.logged_by_person?.name || '—'}</td>
                    <td style={{ ...tdStyle, maxWidth: '260px' }}>
                      <span style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: '13px',
                        color: '#4b5563'
                      }}>
                        {entry.message_content || entry.notes || <em style={{ color: '#9ca3af' }}>No message</em>}
                      </span>
                    </td>
                    <td style={tdStyle}><FitStars score={entry.fit_score} /></td>
                    <td style={tdStyle}>
                      <button
                        onClick={(ev) => toggleResponded(entry, ev)}
                        disabled={togglingId === entry.id}
                        title={entry.status === 'replied' ? 'Click to mark as no response' : 'Click to mark as responded'}
                        style={{
                          background: 'none',
                          border: entry.status === 'replied' ? '1px solid #bbf7d0' : '1px dashed #e5e7eb',
                          borderRadius: '999px',
                          padding: '3px 10px',
                          fontSize: '12px',
                          fontWeight: entry.status === 'replied' ? 600 : 400,
                          color: entry.status === 'replied' ? '#15803d' : '#9ca3af',
                          cursor: togglingId === entry.id ? 'wait' : 'pointer'
                        }}
                      >
                        {entry.status === 'replied' ? <><Check size={12} /> Responded</> : 'Mark responded'}
                      </button>
                    </td>
                    <td style={tdStyle}>
                      {expandedId === entry.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </td>
                  </tr>

                  {expandedId === entry.id && (
                    <tr key={`${entry.id}-expanded`} style={{ background: '#fafafa', borderBottom: '1px solid #e5e7eb' }}>
                      <td colSpan={8} style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                          {entry.message_content && (
                            <div>
                              <div style={{ fontSize: '11px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px' }}>
                                Message Content
                              </div>
                              <div style={{
                                background: 'white',
                                border: '1px solid #e5e7eb',
                                borderRadius: '6px',
                                padding: '12px',
                                fontSize: '13px',
                                lineHeight: '1.6',
                                whiteSpace: 'pre-wrap',
                                maxHeight: '200px',
                                overflowY: 'auto'
                              }}>
                                {entry.message_content}
                              </div>
                            </div>
                          )}

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {entry.platform_details && (
                              <div>
                                <div style={metaLabelStyle}>Platform Details</div>
                                <div style={metaValueStyle}>{entry.platform_details}</div>
                              </div>
                            )}
                            {entry.industry && (
                              <div>
                                <div style={metaLabelStyle}>Industry</div>
                                <div style={metaValueStyle}>{entry.industry}</div>
                              </div>
                            )}
                            {entry.deal_size && (
                              <div>
                                <div style={metaLabelStyle}>Deal Size</div>
                                <div style={metaValueStyle}>{entry.deal_size}</div>
                              </div>
                            )}
                            {entry.location && (
                              <div>
                                <div style={metaLabelStyle}>Location</div>
                                <div style={metaValueStyle}>{entry.location}</div>
                              </div>
                            )}
                            {entry.lead_source && (
                              <div>
                                <div style={metaLabelStyle}>Lead Source</div>
                                <div style={metaValueStyle}>{entry.lead_source}</div>
                              </div>
                            )}
                            {entry.notes && (
                              <div>
                                <div style={metaLabelStyle}>Notes</div>
                                <div style={metaValueStyle}>{entry.notes}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const thStyle = {
  padding: '10px 16px',
  textAlign: 'left',
  fontSize: '12px',
  fontWeight: '600',
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em'
}

const tdStyle = {
  padding: '12px 16px',
  fontSize: '14px',
  verticalAlign: 'middle'
}

const metaLabelStyle = {
  fontSize: '11px',
  fontWeight: '600',
  color: '#6b7280',
  textTransform: 'uppercase',
  marginBottom: '4px'
}

const metaValueStyle = {
  fontSize: '13px',
  color: '#374151',
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: '4px',
  padding: '6px 10px'
}

export default OutreachAdmin
