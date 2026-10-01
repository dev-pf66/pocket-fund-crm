import { useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useApp } from '../App'
import { isAdminUser } from '../lib/admin'
import CommandPalette from './CommandPalette'
import { useNotificationCount } from '../hooks/useNotificationCount'
import { buildNavGroups } from '../lib/nav'
import { Users, Mail, FileText, BarChart3, Target, HelpCircle, ClipboardList, Menu, X, Briefcase, Shield, Handshake, Presentation, Store, Sun, Search, PhoneCall, Globe } from 'lucide-react'

// Icon names live in src/lib/nav.js so that module stays pure and testable
// (there is no component-test setup here, and the node-environment suite cannot
// import JSX). This map is the only place they become elements.
const ICONS = {
  Sun, Target, PhoneCall, ClipboardList, Users, Presentation, Store, Briefcase,
  Handshake, BarChart3, Mail, FileText, Shield, HelpCircle, Globe
}

function Layout() {
  const { signOut } = useAuth()
  const { currentPerson } = useApp()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isAdmin = isAdminUser(currentPerson)
  // Admins additionally get the unowned-lead signal, so the badge has to know.
  const notifications = useNotificationCount(currentPerson?.id, { isAdmin })

  // Grouped nav. The structure lives in src/lib/nav.js — pure data, so the
  // shape is pinned by test/nav-shape.test.js. Sept 2026: Today absorbed
  // Notifications and Dashboard as sub-tabs, Queue lost its entry and Log went
  // admin-only, taking an analyst's menu from 14 items to 10. Every route still
  // exists; see that module for the reasoning.
  const navGroups = buildNavGroups({ isAdmin, notifications })

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
        <button
          onClick={() => {
            setMobileMenuOpen(false)
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
            margin: '0 0 12px', padding: '7px 10px',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '8px', color: 'inherit', opacity: 0.75, cursor: 'pointer',
            fontSize: '13px', textAlign: 'left'
          }}
        >
          <Search size={14} /> Search
          <span style={{ marginLeft: 'auto', fontSize: '11px', opacity: 0.7 }}>⌘K</span>
        </button>
        <nav>{navGroups.map(group => (
          <div key={group.label} className="nav-group">
            <div className="nav-group-label">{group.label}</div>
            {group.items.map(item => {
              const Icon = ICONS[item.icon]
              return (
              <NavLink key={item.to} to={item.to} onClick={() => setMobileMenuOpen(false)}>
                {Icon && <Icon size={18} />}{item.label}
                {item.badge > 0 && (
                  <span
                    title={item.badgeUrgent ? 'Overdue follow-ups' : 'Follow-ups due today'}
                    style={{
                      marginLeft: 'auto', minWidth: '20px', padding: '1px 6px',
                      borderRadius: '999px', fontSize: '11px', fontWeight: 700,
                      textAlign: 'center', color: 'white',
                      background: item.badgeUrgent ? '#dc2626' : '#2563eb'
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </NavLink>
              )
            })}
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

      <CommandPalette includePartners />
    </div>
  )
}

export default Layout
