import { useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useApp, PARTNERS_OWNER_EMAIL } from '../App'
import { isAdminUser } from '../lib/admin'
import { LayoutDashboard, Users, Mail, FileText, BarChart3, Target, HelpCircle, ClipboardList, Menu, X, Briefcase, Shield, Inbox, Handshake, Presentation, Store } from 'lucide-react'

function Layout() {
  const { signOut } = useAuth()
  const { currentPerson } = useApp()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const isAdmin = isAdminUser(currentPerson)
  const isPartnersOwner = currentPerson?.email === PARTNERS_OWNER_EMAIL

  // Grouped nav — sections keep the eleven items from reading as one flat
  // "which page do I use?" list. Each item carries a `show` flag; groups with
  // no visible items are dropped.
  const navGroups = [
    {
      label: 'Daily Work',
      items: [
        { to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
        { to: '/outreach', label: 'Tracker', icon: <Target size={18} /> },
        { to: '/outreach-queue', label: 'Queue', icon: <Inbox size={18} /> },
        { to: '/outreach-admin', label: 'Log', icon: <ClipboardList size={18} /> },
      ],
    },
    {
      label: 'Pipelines',
      items: [
        { to: '/pipeline', label: 'Pipeline', icon: <Users size={18} /> },
        { to: '/pe-os', label: 'PE OS', icon: <Presentation size={18} /> },
        { to: '/sellers', label: 'Indian Sellers', icon: <Store size={18} /> },
        { to: '/investors', label: 'Investors', icon: <Briefcase size={18} /> },
        { to: '/partners', label: 'Partners', icon: <Handshake size={18} />, show: isPartnersOwner },
      ],
    },
    {
      label: 'Insights',
      items: [
        { to: '/analytics', label: 'Analytics', icon: <BarChart3 size={18} /> },
      ],
    },
    {
      label: 'Setup',
      items: [
        { to: '/templates', label: 'Templates', icon: <Mail size={18} />, show: isAdmin },
        { to: '/samples', label: 'Sample Deals', icon: <FileText size={18} />, show: isAdmin },
        { to: '/admin', label: 'Admin', icon: <Shield size={18} />, show: isAdmin },
        { to: '/help', label: 'Help', icon: <HelpCircle size={18} /> },
      ],
    },
  ]
    .map(g => ({ ...g, items: g.items.filter(i => i.show !== false) }))
    .filter(g => g.items.length > 0)

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
        <nav>{navGroups.map(group => (
          <div key={group.label} className="nav-group">
            <div className="nav-group-label">{group.label}</div>
            {group.items.map(item => (
              <NavLink key={item.to} to={item.to} onClick={() => setMobileMenuOpen(false)}>
                {item.icon}{item.label}
              </NavLink>
            ))}
          </div>
        ))}</nav>
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
