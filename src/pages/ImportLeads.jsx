import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createLead, getLeads } from '../lib/crm-api'
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
  const { currentPerson } = useApp()
  const { toast } = useToast()
  const [csvData, setCsvData] = useState([])
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({})
  const [step, setStep] = useState(1) // 1=upload, 2=map, 3=preview, 4=importing, 5=complete
  const [results, setResults] = useState({ success: 0, duplicates: 0, failed: 0, errors: [] })
  // Dial code applied to a number that arrives without one. Never guessed —
  // a 10-digit number is a valid local number in a dozen countries, and
  // silently picking the wrong one produces a number that looks fine and
  // fails at dial time. '' = leave every number exactly as typed.
  const [phoneCountry, setPhoneCountry] = useState('1')

  const fieldOptions = [
    { value: '', label: '-- Skip --' },
    { value: 'name', label: 'Name *' },
    { value: 'firm_name', label: 'Firm Name' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'linkedin_url', label: 'LinkedIn URL' },
    { value: 'lead_type', label: 'Lead Type' },
    { value: 'deal_criteria', label: 'Deal Criteria' },
    { value: 'notes', label: 'Notes' }
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
        } else if (lower.includes('criteria')) {
          autoMapping[header] = 'deal_criteria'
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
      const lead = { stage: 'new_lead', created_by: currentPerson?.id }

      Object.entries(mapping).forEach(([csvHeader, fieldName]) => {
        if (!fieldName) return
        const raw = row[csvHeader]
        if (!raw) return
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

    const results = { success: 0, duplicates: 0, failed: 0, errors: [] }

    // Build duplicate lookups once from existing leads (email, LinkedIn URL,
    // name+firm pair) so re-uploading a list doesn't create duplicates.
    const existingEmails = new Set()
    const existingLinkedIns = new Set()
    const existingNameFirms = new Set()
    try {
      const existingLeads = await getLeads({}, null)
      for (const existing of existingLeads || []) {
        if (existing.email) existingEmails.add(existing.email.toLowerCase())
        if (existing.linkedin_url) {
          const normalized = normalizeLinkedInUrl(existing.linkedin_url)
          if (normalized) existingLinkedIns.add(normalized)
        }
        if (existing.name) {
          existingNameFirms.add(`${existing.name.toLowerCase()}|${(existing.firm_name || '').toLowerCase()}`)
        }
      }
    } catch (error) {
      // If the lookup fails, proceed without duplicate detection rather than
      // blocking the import entirely.
      console.error('Failed to load existing leads for duplicate check:', error)
    }

    for (const lead of leads) {
      const emailKey = lead.email ? lead.email.toLowerCase() : null
      const linkedinKey = lead.linkedin_url ? normalizeLinkedInUrl(lead.linkedin_url) : null
      const nameFirmKey = lead.name
        ? `${lead.name.toLowerCase()}|${(lead.firm_name || '').toLowerCase()}`
        : null

      const isDuplicate =
        (emailKey && existingEmails.has(emailKey)) ||
        (linkedinKey && existingLinkedIns.has(linkedinKey)) ||
        (nameFirmKey && existingNameFirms.has(nameFirmKey))

      if (isDuplicate) {
        results.duplicates++
        continue
      }

      try {
        // _phone is preview metadata, not a column — it would break the insert.
        const { _phone, ...leadRow } = lead
        void _phone
        await createLead(leadRow, currentPerson?.id)
        results.success++
        // Register keys so duplicates within the same CSV are caught too.
        if (emailKey) existingEmails.add(emailKey)
        if (linkedinKey) existingLinkedIns.add(linkedinKey)
        if (nameFirmKey) existingNameFirms.add(nameFirmKey)
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
            <Upload size={48} color="#9ca3af" />
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

          <div className="import-instructions">
            <h4>CSV Format Tips:</h4>
            <ul>
              <li>First row should contain column headers</li>
              <li>Required: Name column</li>
              <li>Recommended: Firm Name, Email, Phone, LinkedIn URL</li>
              <li>Example: Name, Firm, Email, Phone, LinkedIn, Type, Criteria</li>
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
            <div style={{ marginTop: '20px', padding: '14px', background: 'var(--gray-50, #f9fafb)', borderRadius: '8px' }}>
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
              <p style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--gray-600, #6b7280)' }}>
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
                borderLeft: `4px solid ${phoneSummary.unresolved > 0 ? '#f59e0b' : '#16a34a'}`
              }}
            >
              <strong>Phone numbers:</strong>{' '}
              {phoneSummary.reformatted} reformatted to E.164,{' '}
              {phoneSummary.alreadyValid} already valid
              {phoneSummary.unresolved > 0 && (
                <span style={{ color: '#b45309' }}>
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
                        <div style={{ fontSize: '11px', color: 'var(--gray-500, #9ca3af)' }}>
                          was {lead._phone.original}
                        </div>
                      )}
                      {lead._phone && !lead._phone.ok && (
                        <div style={{ fontSize: '11px', color: '#b45309' }}>
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
                <Check size={64} color="#22c55e" />
                <h2>Import Complete! ✓</h2>
                <p>
                  Successfully imported {results.success} leads
                  {results.duplicates > 0 && <> · {results.duplicates} duplicates skipped</>}
                </p>
              </>
            ) : (
              <>
                <AlertCircle size={64} color="#f59e0b" />
                <h2>Import Finished</h2>
                <p>
                  ✓ {results.success} succeeded<br />
                  {results.duplicates > 0 && <>⊘ {results.duplicates} duplicates skipped<br /></>}
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
