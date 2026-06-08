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
  // Null out all FK references to this person before deleting.
  // The supabase-migration-admin-rls.sql migration adds ON DELETE SET NULL
  // to these constraints, but we do it explicitly here as a safe fallback
  // in case that migration hasn't been applied.
  const nullOuts = [
    supabase.from('crm_leads').update({ created_by: null }).eq('created_by', id),
    supabase.from('crm_leads').update({ assigned_to: null }).eq('assigned_to', id),
    supabase.from('crm_leads').update({ assigned_by: null }).eq('assigned_by', id),
    supabase.from('crm_lead_activities').update({ logged_by: null }).eq('logged_by', id),
    supabase.from('crm_outreach_log').update({ logged_by: null }).eq('logged_by', id),
    supabase.from('crm_sample_deals').update({ created_by: null }).eq('created_by', id),
    supabase.from('crm_email_templates').update({ created_by: null }).eq('created_by', id),
    supabase.from('crm_transcripts').update({ created_by: null }).eq('created_by', id),
  ]
  const results = await Promise.all(nullOuts)
  for (const { error } of results) {
    if (error) throw error
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
