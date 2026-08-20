import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session. The .catch matters: without it a rejected
    // getSession (offline cold load, DNS/CORS blip, corrupt stored token)
    // leaves loading=true forever, so the app sits on a full-screen spinner
    // with no login form and no error. onAuthStateChange never touches
    // loading, so nothing else can rescue it.
    supabase.auth.getSession()
      .then(({ data: { session } }) => setUser(session?.user ?? null))
      .catch(err => {
        console.error('Failed to restore session:', err)
        setUser(null)
      })
      .finally(() => setLoading(false))

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      isAuthenticated: !!user,
      signOut
    }}>
      {children}
    </AuthContext.Provider>
  )
}
