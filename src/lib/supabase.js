import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Get current user
export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  return user
}

// Sign in with email
export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })
  if (error) throw error
  return data
}

// Sign up with email
export async function signUpWithEmail(email, password, name) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password
  })
  if (error) throw error

  // Create person record if signup successful
  if (data.user) {
    const { error: personError } = await supabase
      .from('people')
      .insert([{ email, name }])

    if (personError) console.error('Failed to create person record:', personError)
  }

  return data
}

// Sign out
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// Get people (users)
export async function getPeople() {
  const { data, error } = await supabase
    .from('people')
    .select('*')
    .order('name', { ascending: true })

  if (error) throw error
  return data || []
}

export async function setUserAdmin(id, isAdmin) {
  const { data, error } = await supabase
    .from('people')
    .update({ is_admin: isAdmin })
    .eq('id', id)
    .select()
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('No rows updated — RLS may be blocking this action. Run supabase-migration-admin-rls.sql.')
  }
  return data[0]
}

// Generate a share-friendly temporary password. Avoids look-alike
// characters (0/O, 1/l/I) so admins can read it over chat without typos.
export function generateTempPassword(len = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => chars[b % chars.length]).join('')
}

// Admin-only: hard-set a teammate's password without involving email.
// Routes through /api/admin/reset-password which uses the service role.
// Caller must be signed in as an admin; the endpoint re-verifies.
export async function adminSetUserPassword(targetEmail, newPassword) {
  if (!targetEmail) throw new Error('email is required')
  if (!newPassword || newPassword.length < 8) throw new Error('Password must be at least 8 characters')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')
  const res = await fetch('/api/admin/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ target_email: targetEmail, new_password: newPassword })
  })
  let body = null
  try { body = await res.json() } catch { /* empty body */ }
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
  return body
}

// Trigger Supabase's password-recovery email for a teammate. The link in
// the email lands on /reset-password where they set a new password
// (existing PASSWORD_RECOVERY handler in ResetPassword.jsx). redirectTo
// derives from window.location.origin so prod, previews, and local dev
// all route correctly.
export async function sendPasswordResetEmail(email) {
  if (!email) throw new Error('email is required')
  const redirectTo = `${window.location.origin}/reset-password`
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  if (error) throw error
}

export async function deleteUser(id) {
  // Null out FK references to this person before deleting them.
  // supabase-migration-admin-rls.sql adds ON DELETE SET NULL to these
  // constraints, but we do it explicitly here as a fallback. Each null-out
  // is tolerant of missing tables/columns — e.g. if a project never created
  // crm_email_templates, we shouldn't block the user-removal because of it.
  //
  // Postgres error codes:
  //   42P01 — undefined_table (table doesn't exist)
  //   42703 — undefined_column (column doesn't exist)
  // PostgREST also surfaces these as "PGRST205 / PGRST204" with the same
  // message about schema cache, so we match on both.
  function isMissingSchemaError(error) {
    if (!error) return false
    if (error.code === '42P01' || error.code === '42703') return true
    if (error.code === 'PGRST205' || error.code === 'PGRST204') return true
    const msg = String(error.message || '').toLowerCase()
    return msg.includes('schema cache') || msg.includes('does not exist')
  }

  const nullOuts = [
    ['crm_leads', 'created_by'],
    ['crm_leads', 'assigned_to'],
    ['crm_leads', 'assigned_by'],
    ['crm_lead_activities', 'logged_by'],
    ['crm_outreach_log', 'logged_by'],
    ['crm_sample_deals', 'created_by'],
    ['crm_email_templates', 'created_by'],
    ['crm_transcripts', 'created_by']
  ]

  for (const [table, column] of nullOuts) {
    const { error } = await supabase.from(table).update({ [column]: null }).eq(column, id)
    if (!error) continue
    if (isMissingSchemaError(error)) {
      console.warn(`deleteUser: skipping ${table}.${column} — ${error.message}`)
      continue
    }
    throw error
  }

  const { data, error } = await supabase
    .from('people')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('No rows deleted — RLS may be blocking this action. Run supabase-migration-admin-rls.sql.')
  }
}
