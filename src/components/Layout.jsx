import { useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useApp, PARTNERS_OWNER_EMAIL } from '../App'
import { LayoutDashboard, Users, Mail, FileText, BarChart3, Target, HelpCircle, ClipboardList, Menu, X, CheckSquare, Briefcase, Shield, Inbox, Handshake } from 'lucide-react'

// Fallback until is_admin column is populated on every person record.
const BOOTSTRAP_ADMIN_EMAIL = 'dev@pocket-fund.com'
function isAdminUser(person) {
  if (!person) return false
  return Boolean(person.is_admin) || person.email === BOOTSTRAP_ADMIN_EMAIL
}

function Layout() {
  const { signOut } = useAuth()
  const { currentPerson } = useApp()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="app-layout">
      {/* Mobile header with hamburger */}
      <div className="mobile-header">
        <h1>PF CRM</h1>
        <button
          className="mobile-menu-toggle"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <h1>PF Sales CRM</h1>
        <nav>
          <NavLink to="/dashboard" onClick={() => setMobileMenuOpen(false)}><LayoutDashboard size={18} />Dashboard</NavLink>
          <NavLink to="/pipeline" onClick={() => setMobileMenuOpen(false)}><Users size={18} />Sales Pipeline</NavLink>
          <NavLink to="/outreach" onClick={() => setMobileMenuOpen(false)}><Target size={18} />Outreach Tracker</NavLink>
          <NavLink to="/outreach-queue" onClick={() => setMobileMenuOpen(false)}><Inbox size={18} />Outreach Queue</NavLink>
          <NavLink to="/outreach-admin" onClick={() => setMobileMenuOpen(false)}><ClipboardList size={18} />Outreach Log</NavLink>
          <NavLink to="/my-goals" onClick={() => setMobileMenuOpen(false)}><CheckSquare size={18} />Goals</NavLink>
          <NavLink to="/analytics" onClick={() => setMobileMenuOpen(false)}><BarChart3 size={18} />Analytics</NavLink>
          <NavLink to="/investors" onClick={() => setMobileMenuOpen(false)}><Briefcase size={18} />Investor Contacts</NavLink>
          <NavLink to="/templates" onClick={() => setMobileMenuOpen(false)}><Mail size={18} />Email Templates</NavLink>
          <NavLink to="/samples" onClick={() => setMobileMenuOpen(false)}><FileText size={18} />Sample Deals</NavLink>
          <NavLink to="/help" onClick={() => setMobileMenuOpen(false)}><HelpCircle size={18} />Help</NavLink>
          {currentPerson?.email === PARTNERS_OWNER_EMAIL && (
            <NavLink to="/partners" onClick={() => setMobileMenuOpen(false)}><Handshake size={18} />Potential Partners</NavLink>
          )}
          {isAdminUser(currentPerson) && (
            <NavLink to="/admin" onClick={() => setMobileMenuOpen(false)}><Shield size={18} />Admin</NavLink>
          )}
        </nav>
        <div className="user-info">
          <div className="user-avatar">
            {currentPerson?.name?.split(' ').map(n => n[0]).join('') || '?'}
          </div>
          <div className="user-details">
            <span className="user-name">{currentPerson?.name || 'Unknown'}</span>
            <span className="user-email">{currentPerson?.email}</span>
          </div>
          <button className="btn-sign-out" onClick={signOut} title="Sign out">↪</button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="mobile-overlay"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
