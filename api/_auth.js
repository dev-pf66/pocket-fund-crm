import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY

// Shared request auth for the AI endpoints. Accepts EITHER a signed-in
// Supabase user (the app sends Authorization: Bearer <jwt>) OR the legacy
// shared API key (external callers send x-api-key). The app uses the
// Bearer path so we never ship CRM_API_KEY to the browser bundle.
export async function isAuthorized(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (auth?.startsWith('Bearer ') && supabaseUrl && supabaseAnon) {
    try {
      const anon = createClient(supabaseUrl, supabaseAnon)
      const { data, error } = await anon.auth.getUser(auth.slice(7))
      if (!error && data?.user) return true
    } catch { /* fall through to api-key check */ }
  }
  const apiKey = req.headers['x-api-key'] || req.query?.api_key
  const validKey = process.env.CRM_API_KEY
  return Boolean(validKey) && apiKey === validKey
}
