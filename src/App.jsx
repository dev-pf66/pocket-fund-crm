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

// After a deploy, users with a cached index.html reference chunk filenames
// that no longer exist on the CDN. Detect that failure mode and reload once
// to pick up the fresh index.html + chunk hashes. The sessionStorage flag
// prevents an infinite reload loop if the error is genuinely something else.
function lazyWithRetry(importer) {
  return lazy(async () => {
    try {
      const mod = await importer()
      sessionStorage.removeItem('chunk-reload-attempted')
      return mod
    } catch (err) {
      const msg = String(err?.message || err || '')
      const isChunkLoadError = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg)
      if (isChunkLoadError && !sessionStorage.getItem('chunk-reload-attempted')) {
        sessionStorage.setItem('chunk-reload-attempted', '1')
        window.location.reload()
        return { default: () => null }
      }
      throw err
    }
  })
}

// Lazy-loaded — less frequently visited pages
const EmailTemplates = lazyWithRetry(() => import('./pages/EmailTemplates'))
const SampleDeals = lazyWithRetry(() => import('./pages/SampleDeals'))
const ImportLeads = lazyWithRetry(() => import('./pages/ImportLeads'))
const Analytics = lazyWithRetry(() => import('./pages/Analytics'))
const OutreachTracker = lazyWithRetry(() => import('./pages/OutreachTracker'))
const OutreachAdmin = lazyWithRetry(() => import('./pages/OutreachAdmin'))
const OutreachQueue = lazyWithRetry(() => import('./pages/OutreachQueue'))
const MyGoals = lazyWithRetry(() => import('./pages/MyGoals'))
const Admin = lazyWithRetry(() => import('./pages/Admin'))
const Help = lazyWithRetry(() => import('./pages/Help'))
const HelpAdmin = lazyWithRetry(() => import('./pages/HelpAdmin'))
const ChatTerminal = lazyWithRetry(() => import('./components/ChatTerminal'))
const PartnersBoard = lazyWithRetry(() => import('./pages/PartnersBoard'))
const PEOSBoard = lazyWithRetry(() => import('./pages/PEOSBoard'))

// Email of the only person who can see the Potential Partners tab.
// Personal pipeline — RLS already isolates the data, but the route + nav
// link are gated so it never appears for other users.
export const PARTNERS_OWNER_EMAIL = 'dev@pocket-fund.com'

export const AppContext = createContext()

export function useApp() {
  return useContext(AppContext)
}

const BOOTSTRAP_ADMIN_EMAIL = 'dev@pocket-fund.com'
function isAdminUser(person) {
  if (!person) return false
  return Boolean(person.is_admin) || person.email === BOOTSTRAP_ADMIN_EMAIL
}

function AppContent() {
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const [currentPerson, setCurrentPerson] = useState(null)
  const [people, setPeople] = useState([])
  const [dataLoading, setDataLoading] = useState(false)
  const isAdmin = isAdminUser(currentPerson)

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
              <Route path="outreach-queue" element={<OutreachQueue />} />
              <Route path="outreach-admin" element={<OutreachAdmin />} />
              <Route path="pe-os" element={<PEOSBoard />} />
              <Route path="my-goals" element={<MyGoals />} />
              <Route path="admin" element={<Admin />} />
              <Route path="import" element={<ImportLeads />} />
              {/* Analytics is open to everyone — non-admins see only
                  their own numbers (auto-scoped by RLS + the page's
                  built-in admin check). The other admin pages stay gated. */}
              <Route path="analytics" element={<Analytics />} />
              {isAdmin && <>
                <Route path="investors" element={<Investors />} />
                <Route path="investors/:id" element={<InvestorDetail />} />
                <Route path="templates" element={<EmailTemplates />} />
                <Route path="samples" element={<SampleDeals />} />
              </>}
              <Route path="help" element={<Help />} />
              <Route path="help/admin" element={<HelpAdmin />} />
              {currentPerson?.email === PARTNERS_OWNER_EMAIL && (
                <Route path="partners" element={<PartnersBoard />} />
              )}
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
