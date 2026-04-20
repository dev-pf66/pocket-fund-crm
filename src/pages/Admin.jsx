import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useApp } from '../App'
import { getPeople } from '../lib/supabase'
import { Shield, Users as UsersIcon } from 'lucide-react'

export const ADMIN_EMAIL = 'dev@pocket-fund.com'

function Admin() {
  const { currentPerson } = useApp()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const data = await getPeople()
        if (!cancelled) setUsers(data)
      } catch (err) {
        console.error('Failed to load users:', err)
        if (!cancelled) setError(err.message || 'Failed to load users')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (currentPerson && currentPerson.email !== ADMIN_EMAIL) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="page-container">
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
          <Shield size={24} /> Admin
        </h1>
        <p style={{ color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
          Internal tools. Visible only to {ADMIN_EMAIL}.
        </p>
      </div>

      <div className="card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: '600' }}>
            <UsersIcon size={18} /> All Users
          </h3>
          <span style={{ fontSize: '13px', color: '#6b7280' }}>
            {loading ? '' : `${users.length} ${users.length === 1 ? 'user' : 'users'}`}
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 12px' }}></div>
            Loading users…
          </div>
        ) : error ? (
          <div style={{ padding: '20px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#991b1b' }}>
            {error}
          </div>
        ) : users.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
            No users found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151' }}>Name</th>
                  <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151' }}>Email</th>
                  <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151' }}>ID</th>
                  <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151' }}>Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 8px', color: '#111827', fontWeight: '500' }}>
                      {u.name || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>No name</span>}
                      {u.email === currentPerson?.email && (
                        <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: '600', color: '#1d4ed8', padding: '2px 6px', background: '#eff6ff', borderRadius: '10px' }}>
                          you
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 8px', color: '#374151' }}>{u.email || '—'}</td>
                    <td style={{ padding: '10px 8px', color: '#6b7280', fontFamily: 'monospace', fontSize: '12px' }}>{u.id}</td>
                    <td style={{ padding: '10px 8px', color: '#6b7280' }}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Admin
