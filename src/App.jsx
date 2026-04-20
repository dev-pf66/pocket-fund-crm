import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect, createContext, useContext, lazy, Suspense } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { getPeople, supabase } from './lib/supabase'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import Login from './pages/Login'
import Signup from './pages/Signup'
import ResetPassword from './pages/ResetPassword'

// Eagerly loaded — these are the main pages users navigate between
import Dashboard from './pages/Dashboard'
import LeadsBoard from './pages/LeadsBoard'
import LeadDetail from './pages/LeadDetail'
import Investors from './pages/Investors'
import InvestorDetail from './pages/InvestorDetail'

// Lazy-loaded — less frequently visited pages
const EmailTemplates = lazy(() => import('./pages/EmailTemplates'))
const SampleDeals = lazy(() => import('./pages/SampleDeals'))
const ImportLeads = lazy(() => import('./pages/ImportLeads'))
const Analytics = lazy(() => import('./pages/Analytics'))
const OutreachTracker = lazy(() => import('./pages/OutreachTracker'))
const OutreachAdmin = lazy(() => import('./pages/OutreachAdmin'))
const MyGoals = lazy(() => import('./pages/MyGoals'))
const Help = lazy(() => import('./pages/Help'))
const HelpAdmin = lazy(() => import('./pages/HelpAdmin'))
const ChatTerminal = lazy(() => import('./components/ChatTerminal'))

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
      loadData(user.email)
    }
  }, [isAuthenticated, user?.email])

  async function loadData(email) {
    setDataLoading(true)
    try {
      const allPeople = await getPeople()
      setPeople(allPeople)

      let person = allPeople.find(p => p.email === email)

      if (!person) {
        const { data: newPerson, error } = await supabase
          .from('people')
          .insert([{ name: email.split('@')[0], email }])
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
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }

  // Only show the full-screen loader on the very first load (no person yet).
  // Background refreshes after token refresh must not unmount the app.
  if (dataLoading && !currentPerson) {
    return <div className="loading-screen"><div className="loading-spinner"></div><p>Loading...</p></div>
  }

  return (
    <AppContext.Provider value={{ currentPerson, people, setPeople, refreshPeople: () => loadData(user?.email) }}>
      <ToastProvider>
      <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<div className="loading-screen"><div className="loading-spinner"></div><p>Loading...</p></div>}>
          <Routes>
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="pipeline" element={<LeadsBoard />} />
              <Route path="leads/:id" element={<LeadDetail />} />
              <Route path="outreach" element={<OutreachTracker />} />
              <Route path="outreach-admin" element={<OutreachAdmin />} />
              <Route path="my-goals" element={<MyGoals />} />
              <Route path="import" element={<ImportLeads />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="investors" element={<Investors />} />
              <Route path="investors/:id" element={<InvestorDetail />} />
              <Route path="templates" element={<EmailTemplates />} />
              <Route path="samples" element={<SampleDeals />} />
              <Route path="help" element={<Help />} />
              <Route path="help/admin" element={<HelpAdmin />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          <ChatTerminal />
        </Suspense>
      </BrowserRouter>
      </ErrorBoundary>
      </ToastProvider>
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
