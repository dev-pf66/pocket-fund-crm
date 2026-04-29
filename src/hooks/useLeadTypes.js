import { useState, useEffect } from 'react'
import { getLeadTypeOptions } from '../lib/crm-api'

const DEFAULTS = [
  { id: 'pe_firm',             name: 'PE Firm' },
  { id: 'family_office',       name: 'Family Office' },
  { id: 'independent_sponsor', name: 'Independent Sponsor' },
  { id: 'other',               name: 'Other' },
]

// Returns admin-configured lead type options, falling back to built-in defaults
// if the table hasn't been migrated yet or the fetch fails.
export function useLeadTypes() {
  const [leadTypes, setLeadTypes] = useState(DEFAULTS)

  useEffect(() => {
    let cancelled = false
    getLeadTypeOptions()
      .then(data => { if (!cancelled && data?.length) setLeadTypes(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return leadTypes
}
