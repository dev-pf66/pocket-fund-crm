import { useState, useEffect } from 'react'
import { getFieldOptions } from '../lib/crm-api'

/**
 * Admin-editable option list for one crm_field_options field name, shaped for
 * InlineField's `options` prop.
 *
 * Mirrors useLeadTypes deliberately: the vocabulary lives in the database
 * (Admin → field options) rather than a frozen array in the bundle, because the
 * hardcoded lead_type list had to be torn out in Sept 2026 for exactly that
 * reason — Dev adding a buyer type should not need a deploy.
 *
 * Degrades to just the placeholder if the fetch fails, so a select never renders
 * as an empty dropdown with no way out.
 */
export function useFieldOptions(fieldName, placeholder = 'Select…') {
  const [values, setValues] = useState([])

  useEffect(() => {
    let cancelled = false
    getFieldOptions(fieldName)
      .then(rows => { if (!cancelled) setValues((rows || []).map(r => r.value)) })
      .catch(err => console.error(`Field options failed for ${fieldName}:`, err))
    return () => { cancelled = true }
  }, [fieldName])

  return [{ value: '', label: placeholder }, ...values.map(v => ({ value: v, label: v }))]
}
