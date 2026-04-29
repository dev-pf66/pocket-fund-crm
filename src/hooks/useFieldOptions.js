import { useState, useEffect } from 'react'
import { getFieldOptions } from '../lib/crm-api'

const DEFAULTS = {
  industry:    ['SaaS', 'E-commerce', 'F&B', 'Healthcare', 'Manufacturing', 'Real Estate', 'Financial Services', 'Technology', 'Other'],
  deal_size:   ['Under $1M', '$1M–$5M', '$5M–$10M', '$10M–$25M', '$25M–$50M', '$50M+'],
  location:    ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Miami', 'London', 'India', 'Remote', 'Other'],
  lead_source: ['LinkedIn', 'Referral', 'Conference', 'Cold Email', 'Website', 'Other'],
}

export function useFieldOptions(fieldName) {
  const [options, setOptions] = useState(
    (DEFAULTS[fieldName] || []).map((v, i) => ({ id: `default_${i}`, value: v }))
  )

  useEffect(() => {
    let cancelled = false
    getFieldOptions(fieldName)
      .then(data => { if (!cancelled && data?.length) setOptions(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [fieldName])

  return options
}
