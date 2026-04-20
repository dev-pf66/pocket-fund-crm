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
    .single()
  if (error) throw error
  return data
}

export async function deleteUser(id) {
  const { error } = await supabase
    .from('people')
    .delete()
    .eq('id', id)
  if (error) throw error
}
