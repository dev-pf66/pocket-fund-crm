// RFC-4180-ish CSV parser: handles quoted fields, embedded commas, escaped
// double quotes ("") and CRLF. A naive split(',') / split('\n') approach
// silently shifts columns whenever a field contains a comma, causing the
// wrong data to land in neighbouring columns — which Postgres then rejects
// with cryptic errors ("value too long for...", "invalid input syntax
// for type date", etc.). Use this in place of hand-rolled parsers.
export function parseCSVText(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 } else { inQuotes = false }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1
      row.push(field); field = ''
      if (row.some(v => v.length > 0)) rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (row.some(v => v.length > 0)) rows.push(row)
  }
  return rows
}

// Parse a loose date string into YYYY-MM-DD, or null if it doesn't look like
// a date. Used to guard CSV imports where a misaligned column could send a
// non-date value (e.g. "Replied") into a Postgres DATE column.
export function parseDateCell(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  // Fast path: already ISO-ish (YYYY-MM-DD[...])
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().split('T')[0]
}
