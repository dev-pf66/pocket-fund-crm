import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect, createContext, useContext } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { getPeople, supabase } from './lib/supabase'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import LeadsBoard from './pages/LeadsBoard'
import Login from './pages/Login'
import Signup from './pages/Signup'

export const AppContext = createContext()

export function useApp() {
  return useContext(AppContext)
}

function AppContent() {
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const [currentPerson, setCurrentPerson] = useState(null)
  const [people, setPeople] = useState([])
  const [dataLoading, setDataLoading] = useState(false)

  useEffect(() => {
    if (isAuthenticated && user?.email) {
      loadData()
    }
  }, [isAuthenticated, user])

  async function loadData() {
    setDataLoading(true)
    try {
      const allPeople = await getPeople()
      setPeople(allPeople)

      let person = allPeople.find(p => p.email === user.email)

      if (!person) {
        const { data: newPerson, error } = await supabase
          .from('people')
          .insert([{ name: user.email.split('@')[0], email: user.email }])
          .select()
          .single()

        if (!error && newPerson) {
          person = newPerson
          setPeople([...allPeople, newPerson])
        }
      }

      setCurrentPerson(person)
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setDataLoading(false)
    }
  }

  if (authLoading) {
    return <div className="loading-screen"><div className="loading-spinner"></div><p>Loading...</p></div>
  }

  if (!isAuthenticated) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }

  if (dataLoading) {
    return <div className="loading-screen"><div className="loading-spinner"></div><p>Loading...</p></div>
  }

  return (
    <AppContext.Provider value={{ currentPerson, people, setPeople, refreshPeople: loadData }}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="pipeline" element={<LeadsBoard />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppContext.Provider>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
