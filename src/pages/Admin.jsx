import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useApp } from '../App'
import { getPeople, setUserAdmin, deleteUser, sendPasswordResetEmail, adminSetUserPassword, generateTempPassword, setUserArchived } from '../lib/supabase'
import { getLeadTypeOptions, addLeadTypeOption, deleteLeadTypeOption, getFieldOptions, addFieldOption, deleteFieldOption } from '../lib/crm-api'
import { useToast } from '../components/Toast'
import { Shield, Users as UsersIcon, Trash2, ShieldCheck, ShieldOff, Tag, Plus, List, KeyRound, Archive, ArchiveRestore } from 'lucide-react'
import { isAdminUser } from '../lib/admin'

function FieldOptionsSection({ title, fieldName, hint }) {
  const { toast } = useToast()
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [newValue, setNewValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    let cancelled = false
    getFieldOptions(fieldName)
      .then(data => { if (!cancelled) setOptions(data) })
      .catch(err => console.error(`Failed to load ${fieldName} options:`, err))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fieldName])

  async function handleAdd(e) {
    e.preventDefault()
    const val = newValue.trim()
    if (!val) return
    if (options.some(o => o.value.toLowerCase() === val.toLowerCase())) {
      toast.warn('That option already exists')
      return
    }
    setAdding(true)
    try {
      const created = await addFieldOption(fieldName, val)
      setOptions(prev => [...prev, created])
      setNewValue('')
      toast.success(`"${val}" added`)
    } catch (err) {
      toast.error(`Failed to add: ${err.message}`)
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(opt) {
    if (!confirm(`Remove "${opt.value}"?`)) return
    setDeletingId(opt.id)
    try {
      await deleteFieldOption(opt.id, fieldName)
      setOptions(prev => prev.filter(o => o.id !== opt.id))
      toast.success(`"${opt.value}" removed`)
    } catch (err) {
      toast.error(`Failed to remove: ${err.message}`)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: '600' }}>
          <List size={18} /> {title}
        </h3>
        <span style={{ fontSize: '13px', color: '#6b7280' }}>{loading ? '' : `${options.length} options`}</span>
      </div>
      {hint && <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#9ca3af' }}>{hint}</p>}

      {loading ? (
        <div style={{ padding: '12px 0', color: '#6b7280', fontSize: '13px' }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            {options.map(opt => (
              <div key={opt.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 10px', background: '#f3f4f6', borderRadius: '20px', fontSize: '13px', fontWeight: '500', color: '#374151' }}>
                {opt.value}
                <button onClick={() => handleDelete(opt)} disabled={deletingId === opt.id} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', display: 'flex', alignItems: 'center', color: '#9ca3af' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {options.length === 0 && <span style={{ fontSize: '13px', color: '#9ca3af' }}>No options yet.</span>}
          </div>
          <form onSubmit={handleAdd} style={{ display: 'flex', gap: '8px', maxWidth: '400px' }}>
            <input type="text" value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Add new option…" maxLength={80}
              style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={adding || !newValue.trim()} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Plus size={14} /> {adding ? 'Adding…' : 'Add'}
            </button>
          </form>
        </>
      )}
    </div>
  )
}

function Admin() {
  const { currentPerson, refreshPeople } = useApp()
  const { toast } = useToast()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actingId, setActingId] = useState(null)
  // Reset-password modal: { user, password, saving, applied }
  const [resetTarget, setResetTarget] = useState(null)
  const [resetPasswordValue, setResetPasswordValue] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetApplied, setResetApplied] = useState(false)

  // Lead type state
  const [leadTypes, setLeadTypes] = useState([])
  const [leadTypesLoading, setLeadTypesLoading] = useState(true)
  const [newTypeName, setNewTypeName] = useState('')
  const [addingType, setAddingType] = useState(false)
  const [deletingTypeId, setDeletingTypeId] = useState(null)

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

  useEffect(() => {
    let cancelled = false
    getLeadTypeOptions()
      .then(data => { if (!cancelled) setLeadTypes(data) })
      .catch(err => { console.error('Failed to load lead types:', err) })
      .finally(() => { if (!cancelled) setLeadTypesLoading(false) })
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

  async function handleToggleArchive(user) {
    const nextValue = !user.is_archived
    const label = user.name || user.email
    const msg = nextValue
      ? `Archive ${label}? Their data is kept, but they'll be removed from leaderboards and can't sign in until you unarchive them.`
      : `Unarchive ${label}? They'll be able to sign in and appear on leaderboards again.`
    if (!confirm(msg)) return

    setActingId(user.id)
    try {
      const updated = await setUserArchived(user.id, nextValue)
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, ...updated } : u))
      toast.success(`${label} ${nextValue ? 'archived' : 'unarchived'}`)
      refreshPeople?.()
    } catch (err) {
      console.error('Failed to toggle archive:', err)
      toast.error(`Failed to ${nextValue ? 'archive' : 'unarchive'}: ${err.message}`)
    } finally {
      setActingId(null)
    }
  }

  function openResetPasswordModal(user) {
    const label = user.name || user.email
    if (!user.email) {
      toast.error(`No email on file for ${label} — can't reset password.`)
      return
    }
    if (currentPerson?.id === user.id) {
      toast.warn("Use your own account settings to change your password.")
      return
    }
    setResetTarget(user)
    setResetPasswordValue(generateTempPassword(16))
    setResetApplied(false)
  }

  function closeResetPasswordModal() {
    setResetTarget(null)
    setResetPasswordValue('')
    setResetApplied(false)
    setResetting(false)
  }

  async function handleApplyResetPassword() {
    if (!resetTarget?.email) return
    if (resetPasswordValue.length < 8) {
      toast.warn('Password must be at least 8 characters.')
      return
    }
    setResetting(true)
    try {
      await adminSetUserPassword(resetTarget.email, resetPasswordValue)
      setResetApplied(true)
      toast.success(`Password set for ${resetTarget.email}`)
    } catch (err) {
      console.error('Failed to reset password:', err)
      toast.error(`Failed to reset: ${err.message}`)
    } finally {
      setResetting(false)
    }
  }

  function copyResetPassword() {
    if (!resetPasswordValue) return
    navigator.clipboard?.writeText(resetPasswordValue).then(
      () => toast.success('Password copied'),
      () => toast.warn('Copy failed — select the password and copy manually')
    )
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

  async function handleAddLeadType(e) {
    e.preventDefault()
    const name = newTypeName.trim()
    if (!name) return
    if (leadTypes.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      toast.warn('That lead type already exists')
      return
    }
    setAddingType(true)
    try {
      const created = await addLeadTypeOption(name)
      setLeadTypes(prev => [...prev, created])
      setNewTypeName('')
      toast.success(`"${name}" added`)
    } catch (err) {
      console.error('Failed to add lead type:', err)
      toast.error(`Failed to add lead type: ${err.message}`)
    } finally {
      setAddingType(false)
    }
  }

  async function handleDeleteLeadType(type) {
    if (!confirm(`Remove lead type "${type.name}"? Existing leads with this type will keep their value.`)) return
    setDeletingTypeId(type.id)
    try {
      await deleteLeadTypeOption(type.id)
      setLeadTypes(prev => prev.filter(t => t.id !== type.id))
      toast.success(`"${type.name}" removed`)
    } catch (err) {
      console.error('Failed to delete lead type:', err)
      toast.error(`Failed to remove lead type: ${err.message}`)
    } finally {
      setDeletingTypeId(null)
    }
  }

  return (
    <div className="page-container">
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
          <Shield size={24} /> Admin
        </h1>
        <p style={{ color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
          Manage users, admin access, and lead configuration.
        </p>
      </div>

      {/* Lead Types */}
      <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: '600' }}>
            <Tag size={18} /> Lead Types
          </h3>
          <span style={{ fontSize: '13px', color: '#6b7280' }}>
            {leadTypesLoading ? '' : `${leadTypes.length} types`}
          </span>
        </div>

        {leadTypesLoading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 8px' }}></div>
            Loading…
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
              {leadTypes.map(type => (
                <div
                  key={type.id}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    padding: '5px 10px', background: '#f3f4f6', borderRadius: '20px',
                    fontSize: '13px', fontWeight: '500', color: '#374151'
                  }}
                >
                  {type.name}
                  <button
                    onClick={() => handleDeleteLeadType(type)}
                    disabled={deletingTypeId === type.id}
                    title="Remove this lead type"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '0 2px', display: 'flex', alignItems: 'center',
                      color: '#9ca3af', lineHeight: 1
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {leadTypes.length === 0 && (
                <span style={{ fontSize: '13px', color: '#9ca3af' }}>No lead types configured.</span>
              )}
            </div>

            <form onSubmit={handleAddLeadType} style={{ display: 'flex', gap: '8px', maxWidth: '400px' }}>
              <input
                type="text"
                value={newTypeName}
                onChange={e => setNewTypeName(e.target.value)}
                placeholder="e.g., Search Fund"
                style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
                maxLength={60}
              />
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={addingType || !newTypeName.trim()}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Plus size={14} />
                {addingType ? 'Adding…' : 'Add'}
              </button>
            </form>
          </>
        )}
      </div>

      <FieldOptionsSection title="Industry Options" fieldName="industry" hint="Shown in the outreach log — the lead's sector." />
      <FieldOptionsSection title="Deal Size Options" fieldName="deal_size" hint="Shown in the outreach log — target deal value." />
      <FieldOptionsSection title="Location Options" fieldName="location" hint="Shown in the outreach log — where the lead is based." />
      <FieldOptionsSection title="Lead Source Options" fieldName="lead_source" hint="Shown in the outreach log — how you found the lead." />

      {/* Users */}
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
                      <td style={{ padding: '10px 8px', color: u.is_archived ? '#9ca3af' : '#111827', fontWeight: '500' }}>
                        {u.name || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>No name</span>}
                        {isSelf && (
                          <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: '600', color: '#1d4ed8', padding: '2px 6px', background: '#eff6ff', borderRadius: '10px' }}>
                            you
                          </span>
                        )}
                        {u.is_archived && (
                          <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: '600', color: '#92400e', padding: '2px 6px', background: '#fef3c7', borderRadius: '10px' }}>
                            archived
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
                            onClick={() => openResetPasswordModal(u)}
                            disabled={busy || !u.email || isSelf}
                            title={
                              isSelf ? "Use your own account settings to change your password"
                              : u.email ? `Set a new password for ${u.email}`
                              : 'No email on file'
                            }
                          >
                            <KeyRound size={14} /> Reset password
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={() => handleToggleArchive(u)}
                            disabled={busy || isSelf}
                            title={
                              isSelf ? "Can't archive yourself"
                              : u.is_archived ? 'Unarchive — restore access + leaderboards'
                              : 'Archive — keep data, hide from leaderboards, block login'
                            }
                          >
                            {u.is_archived
                              ? <><ArchiveRestore size={14} /> Unarchive</>
                              : <><Archive size={14} /> Archive</>}
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

      {resetTarget && (
        <div
          onClick={closeResetPasswordModal}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: '10px', padding: '24px',
              width: '90%', maxWidth: '460px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
            }}
          >
            <h2 style={{ margin: '0 0 6px', fontSize: '18px' }}>
              {resetApplied ? 'Password set' : 'Reset password'}
            </h2>
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
              {resetTarget.name || resetTarget.email}
              <span style={{ color: '#9ca3af' }}> · {resetTarget.email}</span>
            </div>

            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
              New password
            </label>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              <input
                type="text"
                value={resetPasswordValue}
                onChange={(e) => setResetPasswordValue(e.target.value)}
                disabled={resetting}
                style={{
                  flex: 1, padding: '10px 12px',
                  border: '1px solid #d1d5db', borderRadius: '6px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '14px'
                }}
              />
              <button
                className="btn btn-sm"
                onClick={() => setResetPasswordValue(generateTempPassword(16))}
                disabled={resetting}
                title="Generate a new random password"
              >
                Regenerate
              </button>
              <button
                className="btn btn-sm"
                onClick={copyResetPassword}
                disabled={!resetPasswordValue}
              >
                Copy
              </button>
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '20px' }}>
              {resetApplied ? (
                <>Password applied. Copy and share it with {resetTarget.name || resetTarget.email} — they can change it after signing in.</>
              ) : (
                <>Share this password with them after you save. They can change it from their account once signed in.</>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn btn-secondary" onClick={closeResetPasswordModal} disabled={resetting}>
                {resetApplied ? 'Close' : 'Cancel'}
              </button>
              {!resetApplied && (
                <button
                  className="btn btn-primary"
                  onClick={handleApplyResetPassword}
                  disabled={resetting || resetPasswordValue.length < 8}
                >
                  {resetting ? 'Saving…' : 'Set password'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Admin
