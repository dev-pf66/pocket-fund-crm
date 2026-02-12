import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useApp } from '../App'
import { LayoutDashboard, Users, Mail, FileText, BarChart3, Target, HelpCircle } from 'lucide-react'

function Layout() {
  const { signOut } = useAuth()
  const { currentPerson } = useApp()

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <h1>PF Sales CRM</h1>
        <nav>
          <NavLink to="/dashboard"><LayoutDashboard size={18} />Dashboard</NavLink>
          <NavLink to="/pipeline"><Users size={18} />Sales Pipeline</NavLink>
          <NavLink to="/outreach"><Target size={18} />Outreach Tracker</NavLink>
          <NavLink to="/analytics"><BarChart3 size={18} />Analytics</NavLink>
          <NavLink to="/templates"><Mail size={18} />Email Templates</NavLink>
          <NavLink to="/samples"><FileText size={18} />Sample Deals</NavLink>
          <NavLink to="/help"><HelpCircle size={18} />Help</NavLink>
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
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
