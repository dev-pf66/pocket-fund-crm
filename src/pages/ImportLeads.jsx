import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createLead, updateLead, getLeads, getTags, createTag, addTagToLeads } from '../lib/crm-api'
import { normalizeLinkedInUrl } from '../lib/linkedin'
import { useApp } from '../App'
import { Upload, X, Check, AlertCircle } from 'lucide-react'
import { useToast } from '../components/Toast'
import { parseCSVText } from '../lib/csv'
import { normalizePhone, DIAL_CODES } from '../lib/phone'

// Mirrors VARCHAR limits in supabase-crm-schema.sql so we fail soft on long
// inputs instead of letting Postgres reject the row with a cryptic error.
const FIELD_LIMITS = {
  name: 200,
  firm_name: 200,
  email: 255,
  phone: 50,
  lead_type: 50
}

function ImportLeads() {
  const navigate = useNavigate()
  const { currentPerson, people } = useApp()
  const { toast } = useToast()
  const [csvData, setCsvData] = useState([])
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({})
  const [step, setStep] = useState(1) // 1=upload, 2=map, 3=preview, 4=importing, 5=complete
  const [results, setResults] = useState({ success: 0, duplicates: 0, failed: 0, errors: [] })
  const [assignedToId, setAssignedToId] = useState(null) // null = default to currentPerson at import time
  // Dial code applied to a number that arrives without one. Never guessed —
  // a 10-digit number is a valid local number in a dozen countries, and
  // silently picking the wrong one produces a number that looks fine and
  // fails at dial time. '' = leave every number exactly as typed.
  const [phoneCountry, setPhoneCountry] = useState('1')

  const fieldOptions = [
    { value: '', label: '-- Skip --' },
    // Required fields
    { value: 'name', label: 'Name *' },
    { value: 'firm_name', label: 'Firm Name *' },
    { value: 'linkedin_url', label: 'LinkedIn URL *' },
    { value: 'lead_type', label: 'Lead Type *' },
    { value: 'lead_source', label: 'Lead Source *' },
    { value: 'stage', label: 'Stage *' },
    { value: 'outreach_stage', label: 'Outreach Stage *' },
    { value: 'tags', label: 'Tags * (comma-separated)' },
    // Optional fields
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'deal_criteria', label: 'Deal Criteria' },
    { value: 'notes', label: 'Notes' },
    { value: 'message_content', label: 'Message Content' },
  ]

  function handleFileChange(e) {
    const selectedFile = e.target.files[0]
    if (!selectedFile) return

    if (!selectedFile.name.endsWith('.csv')) {
      toast.warn('Please upload a CSV file')
      return
    }

    parseCSV(selectedFile)
  }

  function parseCSV(file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      const parsed = parseCSVText(text)

      if (parsed.length === 0) {
        toast.warn('CSV file is empty')
        return
      }

      const headers = parsed[0].map(h => h.trim())
      const rows = parsed.slice(1).map(values => {
        return headers.reduce((obj, header, index) => {
          obj[header] = (values[index] || '').trim()
          return obj
        }, {})
      })

      setHeaders(headers)
      setCsvData(rows)

      // Auto-map obvious columns
      const autoMapping = {}
      headers.forEach(header => {
        const lower = header.toLowerCase()
        if (lower.includes('name') && !lower.includes('firm') && !lower.includes('company')) {
          autoMapping[header] = 'name'
        } else if (lower.includes('firm') || lower.includes('company')) {
          autoMapping[header] = 'firm_name'
        } else if (lower.includes('email')) {
          autoMapping[header] = 'email'
        } else if (lower.includes('phone')) {
          autoMapping[header] = 'phone'
        } else if (lower.includes('linkedin')) {
          autoMapping[header] = 'linkedin_url'
        } else if (lower.includes('type')) {
          autoMapping[header] = 'lead_type'
        } else if (lower.includes('source')) {
          autoMapping[header] = 'lead_source'
        } else if (lower === 'stage' || lower === 'pipeline stage') {
          autoMapping[header] = 'stage'
        } else if (lower.includes('outreach_stage') || lower === 'outreach stage') {
          autoMapping[header] = 'outreach_stage'
        } else if (lower.includes('tag')) {
          autoMapping[header] = 'tags'
        } else if (lower.includes('criteria')) {
          autoMapping[header] = 'deal_criteria'
        } else if (lower.includes('message') || lower.includes('content')) {
          autoMapping[header] = 'message_content'
        } else if (lower.includes('note')) {
          autoMapping[header] = 'notes'
        }
      })

      setMapping(autoMapping)
      setStep(2)
    }

    reader.readAsText(file)
  }

  function handleMappingChange(csvHeader, fieldName) {
    setMapping({ ...mapping, [csvHeader]: fieldName })
  }

  function getMappedLeads() {
    return csvData.map(row => {
      const targetPersonId = assignedToId ?? currentPerson?.id
      const lead = { stage: 'outreach', created_by: currentPerson?.id, assigned_to: targetPersonId, assigned_by: currentPerson?.id }

      Object.entries(mapping).forEach(([csvHeader, fieldName]) => {
        if (!fieldName) return
        const raw = row[csvHeader]
        if (!raw) return
        if (fieldName === 'tags') {
          lead._tags = raw.split(',').map(t => t.trim()).filter(Boolean)
          return
        }
        if (fieldName === 'fit_score') {
          const n = parseInt(raw, 10)
          if (n >= 1 && n <= 5) lead.fit_score = n
          return
        }
        const limit = FIELD_LIMITS[fieldName]
        lead[fieldName] = limit ? String(raw).slice(0, limit) : raw
      })

      // Store phones as E.164 so the Cold Calls dial button can hand them
      // straight to the dialer. `_phone` carries the before/after for the
      // preview and is stripped before insert.
      if (lead.phone) {
        const norm = normalizePhone(lead.phone, phoneCountry || null)
        lead._phone = { original: lead.phone, ...norm }
        lead.phone = norm.value  // E.164 when resolved, untouched original when not
      }

      return lead
    }).filter(lead => lead.name) // Only include rows with a name
  }

  async function handleImport() {
    const leads = getMappedLeads()

    if (leads.length === 0) {
      toast.warn('No valid leads to import. Make sure you map the Name column.')
      return
    }

    setStep(4)

    const results = { success: 0, updated: 0, unchanged: 0, failed: 0, errors: [] }

    // Build lookup maps: existing leads keyed by linkedin_url, email, name+firm.
    const existingByLinkedIn = new Map()
    const existingByEmail = new Map()
    const existingByNameFirm = new Map()
    try {
      const existingLeads = await getLeads({}, null)
      for (const existing of existingLeads || []) {
        if (existing.linkedin_url) {
          const normalized = normalizeLinkedInUrl(existing.linkedin_url)
          if (normalized) existingByLinkedIn.set(normalized, existing)
        }
        if (existing.email) existingByEmail.set(existing.email.toLowerCase(), existing)
        if (existing.name && existing.firm_name) existingByNameFirm.set(`${existing.name.toLowerCase()}|${existing.firm_name.toLowerCase()}`, existing)
      }
    } catch (error) {
      console.error('Failed to load existing leads for dedup:', error)
    }

    const COMPARABLE = ['name', 'firm_name', 'email', 'phone', 'linkedin_url', 'lead_type', 'lead_source', 'stage', 'outreach_stage', 'deal_criteria', 'notes', 'message_content']
    const allTags = await getTags().catch(() => [])

    for (const lead of leads) {
      const { _phone, _tags, ...leadRow } = lead
      void _phone
      const emailKey = leadRow.email ? leadRow.email.toLowerCase() : null
      const linkedinKey = leadRow.linkedin_url ? normalizeLinkedInUrl(leadRow.linkedin_url) : null
      const nameFirmKey = (leadRow.name && leadRow.firm_name) ? `${leadRow.name.toLowerCase()}|${leadRow.firm_name.toLowerCase()}` : null

      const existing =
        (linkedinKey && existingByLinkedIn.get(linkedinKey)) ||
        (emailKey && existingByEmail.get(emailKey)) ||
        (nameFirmKey && existingByNameFirm.get(nameFirmKey))

      try {
        let leadId
        if (existing) {
          const changes = {}
          for (const field of COMPARABLE) {
            if (leadRow[field] !== undefined && String(leadRow[field]) !== String(existing[field] ?? '')) {
              changes[field] = leadRow[field]
            }
          }
          if (Object.keys(changes).length > 0) {
            await updateLead(existing.id, changes, currentPerson?.id)
            results.updated++
          } else {
            results.unchanged++
          }
          leadId = existing.id
        } else {
          const created = await createLead(leadRow, currentPerson?.id)
          leadId = created?.id
          results.success++
          if (linkedinKey) existingByLinkedIn.set(linkedinKey, { ...leadRow, id: leadId })
          if (emailKey) existingByEmail.set(emailKey, { ...leadRow, id: leadId })
          if (nameFirmKey) existingByNameFirm.set(nameFirmKey, { ...leadRow, id: leadId })
        }

        if (_tags?.length && leadId) {
          for (const tagName of _tags) {
            let tag = allTags.find(t => t.name.toLowerCase() === tagName.toLowerCase())
            if (!tag) tag = await createTag(tagName)
            if (tag?.id) await addTagToLeads([leadId], tag.id)
          }
        }
      } catch (error) {
        results.failed++
        results.errors.push(`${lead.name}: ${error.message}`)
      }
    }

    setResults(results)
    setStep(5)
  }

  const mappedLeads = step >= 3 ? getMappedLeads() : []
  const phoneSummary = mappedLeads.reduce((acc, l) => {
    if (!l._phone) return acc
    acc.withPhone += 1
    if (!l._phone.ok) acc.unresolved += 1
    else if (l._phone.changed) acc.reformatted += 1
    else acc.alreadyValid += 1
    return acc
  }, { withPhone: 0, reformatted: 0, alreadyValid: 0, unresolved: 0 })

  return (
    <div>
      <div className="page-header">
        <h1>Import Leads from CSV</h1>
        {step < 5 && (
          <button className="btn btn-secondary" onClick={() => navigate('/pipeline')}>
            Cancel
          </button>
        )}
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="card import-card">
          <div className="upload-zone" onClick={() => document.getElementById('csv-upload').click()}>
            <Upload size={48} color="var(--text-muted)" />
            <h3>Upload CSV File</h3>
            <p>Click to browse or drag and drop</p>
            <input
              id="csv-upload"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>

          <div style={{ padding: '0 4px 16px' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '13px' }}>
              Assign leads to
            </label>
            <select
              value={assignedToId ?? ''}
              onChange={e => setAssignedToId(e.target.value ? Number(e.target.value) : null)}
              style={{ width: '100%', maxWidth: '320px' }}
            >
              <option value="">Myself ({currentPerson?.name})</option>
              {(people || []).filter(p => p.id !== currentPerson?.id && !p.is_archived).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="import-instructions">
            <h4>CSV Format Tips:</h4>
            <ul>
              <li>First row should contain column headers</li>
              <li><strong>Required:</strong> Name, Firm Name, LinkedIn URL, Lead Type, Lead Source, Stage, Outreach Stage, Tags</li>
              <li><strong>Optional:</strong> Email, Phone, Deal Criteria, Notes, Message Content</li>
              <li>Existing leads are matched by LinkedIn URL → Email → Name + Firm and updated with any new information</li>
            </ul>
          </div>
        </div>
      )}

      {/* Step 2: Map Columns */}
      {step === 2 && (
        <div className="card">
          <h2>Map CSV Columns</h2>
          <p style={{ marginBottom: '24px', color: 'var(--gray-600)' }}>
            Match your CSV columns to lead fields. Name is required.
          </p>

          <div className="mapping-grid">
            {headers.map(header => (
              <div key={header} className="mapping-row">
                <div className="csv-column">
                  <strong>{header}</strong>
                  <span className="preview-value">{csvData[0]?.[header]}</span>
                </div>
                <div className="arrow">→</div>
                <select
                  value={mapping[header] || ''}
                  onChange={(e) => handleMappingChange(header, e.target.value)}
                >
                  {fieldOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {Object.values(mapping).includes('phone') && (
            <div style={{ marginTop: '20px', padding: '14px', background: 'var(--gray-50)', borderRadius: 'var(--radius-md)' }}>
              <label className="form-label" style={{ display: 'block', marginBottom: '6px' }}>
                Country for numbers with no country code
              </label>
              <select
                className="form-select"
                style={{ maxWidth: '280px' }}
                value={phoneCountry}
                onChange={(e) => setPhoneCountry(e.target.value)}
              >
                {DIAL_CODES.map(c => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
                <option value="">Don&apos;t guess — leave as typed</option>
              </select>
              <p style={{ margin: '8px 0 0', fontSize: 'var(--fs-base)', color: 'var(--gray-600)' }}>
                Phones are stored as +1XXXXXXXXXX so the Cold Calls dial button works.
                A number that already starts with + or 00 is kept as-is; anything that
                can&apos;t be resolved is imported unchanged and flagged in the preview.
              </p>
            </div>
          )}

          <div style={{ marginTop: '24px', display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary" onClick={() => setStep(3)}>
              Preview ({csvData.length} rows)
            </button>
            <button className="btn btn-secondary" onClick={() => setStep(1)}>
              Back
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 3 && (
        <div className="card">
          <h2>Preview Import</h2>
          <p style={{ marginBottom: '16px', color: 'var(--gray-600)' }}>
            {mappedLeads.length} leads will be imported
          </p>

          {phoneSummary.withPhone > 0 && (
            <div
              className="card"
              style={{
                marginBottom: '16px', padding: '12px 14px',
                borderLeft: `4px solid ${phoneSummary.unresolved > 0 ? 'var(--warning)' : 'var(--success)'}`
              }}
            >
              <strong>Phone numbers:</strong>{' '}
              {phoneSummary.reformatted} reformatted to E.164,{' '}
              {phoneSummary.alreadyValid} already valid
              {phoneSummary.unresolved > 0 && (
                <span style={{ color: 'var(--warning-text)' }}>
                  , <strong>{phoneSummary.unresolved} couldn&apos;t be resolved</strong> — imported
                  as typed and marked below. Those won&apos;t dial reliably.
                </span>
              )}
            </div>
          )}

          <div className="preview-table-container">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Firm</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {mappedLeads.slice(0, 10).map((lead, idx) => (
                  <tr key={idx}>
                    <td>{lead.name}</td>
                    <td>{lead.firm_name || '-'}</td>
                    <td>{lead.email || '-'}</td>
                    <td>
                      {lead.phone || '-'}
                      {lead._phone?.changed && (
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--gray-500)' }}>
                          was {lead._phone.original}
                        </div>
                      )}
                      {lead._phone && !lead._phone.ok && (
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning-text)' }}>
                          ⚠ {lead._phone.reason}
                        </div>
                      )}
                    </td>
                    <td>{lead.lead_type || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mappedLeads.length > 10 && (
              <p style={{ textAlign: 'center', marginTop: '12px', color: 'var(--gray-500)' }}>
                ... and {mappedLeads.length - 10} more
              </p>
            )}
          </div>

          <div style={{ marginTop: '24px', display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary" onClick={handleImport}>
              Import {mappedLeads.length} Leads
            </button>
            <button className="btn btn-secondary" onClick={() => setStep(2)}>
              Back
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Importing */}
      {step === 4 && (
        <div className="card import-card">
          <div className="importing-state">
            <div className="spinner"></div>
            <h3>Importing leads...</h3>
            <p>{results.success} of {csvData.length} imported</p>
          </div>
        </div>
      )}

      {/* Step 5: Complete */}
      {step === 5 && (
        <div className="card import-card">
          <div className="import-results">
            {results.failed === 0 ? (
              <>
                <Check size={64} color="var(--success-text)" />
                <h2>Import Complete! ✓</h2>
                <p>
                  {[
                    results.success > 0 && `${results.success} added`,
                    results.updated > 0 && `${results.updated} updated`,
                    results.unchanged > 0 && `${results.unchanged} unchanged`,
                  ].filter(Boolean).join(' · ')}
                </p>
              </>
            ) : (
              <>
                <AlertCircle size={64} color="var(--warning-text)" />
                <h2>Import Finished</h2>
                <p>
                  {results.success > 0 && <>✓ {results.success} added<br /></>}
                  {results.updated > 0 && <>↑ {results.updated} updated<br /></>}
                  {results.unchanged > 0 && <>— {results.unchanged} unchanged<br /></>}
                  ✗ {results.failed} failed
                </p>
                {results.errors.length > 0 && (
                  <div className="error-list">
                    <h4>Errors:</h4>
                    {results.errors.slice(0, 5).map((err, idx) => (
                      <div key={idx} className="error-item">{err}</div>
                    ))}
                  </div>
                )}
              </>
            )}

            <button
              className="btn btn-primary"
              onClick={() => navigate('/pipeline')}
              style={{ marginTop: '24px' }}
            >
              View Pipeline
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ImportLeads
