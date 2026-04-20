import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useApp } from '../App'
import { getPeople, setUserAdmin, deleteUser } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { Shield, Users as UsersIcon, Trash2, ShieldCheck, ShieldOff } from 'lucide-react'

// Fallback bootstrap admin — used until the is_admin column is populated.
// Once the migration seeds is_admin=true for this email, this is moot.
const BOOTSTRAP_ADMIN_EMAIL = 'dev@pocket-fund.com'

function isAdminUser(person) {
  if (!person) return false
  return Boolean(person.is_admin) || person.email === BOOTSTRAP_ADMIN_EMAIL
}

function Admin() {
  const { currentPerson, refreshPeople } = useApp()
  const { toast } = useToast()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actingId, setActingId] = useState(null)

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

  if (currentPerson && !isAdminUser(currentPerson)) {
    return <Navigate to="/dashboard" replace />
  }

  async function handleToggleAdmin(user) {
    const nextValue = !user.is_admin
    const action = nextValue ? 'make admin' : 'remove admin'
    if (!confirm(`${nextValue ? 'Promote' : 'Demote'} ${user.name || user.email} — ${action}?`)) return

    setActingId(user.id)
    try {
      const updated = await setUserAdmin(user.id, nextValue)
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, ...updated } : u))
      toast.success(`${user.name || user.email} ${nextValue ? 'is now an admin' : 'is no longer an admin'}`)
      refreshPeople?.()
    } catch (err) {
      console.error('Failed to toggle admin:', err)
      toast.error('Failed to update admin status')
    } finally {
      setActingId(null)
    }
  }

  async function handleRemove(user) {
    const label = user.name || user.email
    const confirmMsg = `Remove ${label}? This permanently deletes their user record and all linked data (goals, progress). They can sign in again to create a new record.`
    if (!confirm(confirmMsg)) return

    setActingId(user.id)
    try {
      await deleteUser(user.id)
      setUsers(prev => prev.filter(u => u.id !== user.id))
      toast.success(`${label} removed`)
      refreshPeople?.()
    } catch (err) {
      console.error('Failed to remove user:', err)
      toast.error(`Failed to remove user: ${err.message}`)
    } finally {
      setActingId(null)
    }
  }

  return (
    <div className="page-container">
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
          <Shield size={24} /> Admin
        </h1>
        <p style={{ color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
          Manage users and admin access.
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
                  <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151' }}>Role</th>
                  <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151' }}>Joined</th>
                  <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const isSelf = u.id === currentPerson?.id
                  const busy = actingId === u.id
                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '10px 8px', color: '#111827', fontWeight: '500' }}>
                        {u.name || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>No name</span>}
                        {isSelf && (
                          <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: '600', color: '#1d4ed8', padding: '2px 6px', background: '#eff6ff', borderRadius: '10px' }}>
                            you
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 8px', color: '#374151' }}>{u.email || '—'}</td>
                      <td style={{ padding: '10px 8px' }}>
                        {u.is_admin ? (
                          <span style={{ fontSize: '12px', fontWeight: '600', color: '#7c3aed', padding: '3px 8px', background: '#f3e8ff', borderRadius: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <ShieldCheck size={12} /> Admin
                          </span>
                        ) : (
                          <span style={{ fontSize: '12px', color: '#6b7280' }}>User</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 8px', color: '#6b7280' }}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px' }}>
                          <button
                            className="btn btn-sm"
                            onClick={() => handleToggleAdmin(u)}
                            disabled={busy || isSelf}
                            title={isSelf ? "Can't change your own admin status" : (u.is_admin ? 'Remove admin' : 'Make admin')}
                          >
                            {u.is_admin ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
                            {u.is_admin ? 'Demote' : 'Make admin'}
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={() => handleRemove(u)}
                            disabled={busy || isSelf}
                            title={isSelf ? "Can't remove yourself" : 'Remove user'}
                            style={{ color: isSelf ? '#9ca3af' : '#dc2626' }}
                          >
                            <Trash2 size={14} /> Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Admin
