import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useApp } from '../App'
import { LayoutDashboard, Users } from 'lucide-react'

function Layout() {
  const { signOut } = useAuth()
  const { currentPerson } = useApp()

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <h1>Pocket Fund CRM</h1>
        <nav>
          <NavLink to="/dashboard"><LayoutDashboard size={18} />Dashboard</NavLink>
          <NavLink to="/pipeline"><Users size={18} />Sales Pipeline</NavLink>
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
        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export default Layout
