import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createLead } from '../lib/crm-api'
import { useApp } from '../App'
import { Upload, X, Check, AlertCircle } from 'lucide-react'

function ImportLeads() {
  const navigate = useNavigate()
  const { currentPerson } = useApp()
  const [file, setFile] = useState(null)
  const [csvData, setCsvData] = useState([])
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({})
  const [step, setStep] = useState(1) // 1=upload, 2=map, 3=preview, 4=importing, 5=complete
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState({ success: 0, failed: 0, errors: [] })

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
      alert('Please upload a CSV file')
      return
    }

    setFile(selectedFile)
    parseCSV(selectedFile)
  }

  function parseCSV(file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      const lines = text.split('\n').filter(line => line.trim())

      if (lines.length === 0) {
        alert('CSV file is empty')
        return
      }

      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
      const rows = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
        return headers.reduce((obj, header, index) => {
          obj[header] = values[index] || ''
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
        if (fieldName && row[csvHeader]) {
          lead[fieldName] = row[csvHeader]
        }
      })

      return lead
    }).filter(lead => lead.name) // Only include rows with a name
  }

  async function handleImport() {
    const leads = getMappedLeads()

    if (leads.length === 0) {
      alert('No valid leads to import. Make sure you map the Name column.')
      return
    }

    setStep(4)
    setImporting(true)

    const results = { success: 0, failed: 0, errors: [] }

    for (const lead of leads) {
      try {
        await createLead(lead)
        results.success++
      } catch (error) {
        results.failed++
        results.errors.push(`${lead.name}: ${error.message}`)
      }
    }

    setResults(results)
    setImporting(false)
    setStep(5)
  }

  const mappedLeads = step >= 3 ? getMappedLeads() : []

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
                    <td>{lead.phone || '-'}</td>
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
                <p>Successfully imported {results.success} leads</p>
              </>
            ) : (
              <>
                <AlertCircle size={64} color="#f59e0b" />
                <h2>Import Finished</h2>
                <p>
                  ✓ {results.success} succeeded<br />
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
