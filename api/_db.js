// Paging helper for the serverless functions.
//
// The browser-side twin lives in src/lib/api/core.js; the two can't be shared
// because that module imports the anon-key client. Same trap, same fix:
// PostgREST caps a plain select at the project's max-rows (1000 by default)
// and returns the truncated page with NO error, so any unbounded select that
// is then counted or reduced computes confidently wrong numbers.
//
// Pass a factory, not a builder — a Supabase query builder is single-use:
//
//   const rows = await fetchAllRows(() =>
//     supabase.from('crm_leads').select('stage, lead_source'))

export async function fetchAllRows(queryFactory, { pageSize = 1000, maxRows = Infinity } = {}) {
  const out = []
  for (let from = 0; from < maxRows; from += pageSize) {
    const size = Math.min(pageSize, maxRows - from)
    const { data, error } = await queryFactory().range(from, from + size - 1)
    if (error) throw error
    const page = data || []
    out.push(...page)
    if (page.length < size) break
  }
  return out
}
