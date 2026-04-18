import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signInWithEmail, supabase } from '../lib/supabase'

function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [resetSent, setResetSent] = useState(false)
  const [resetting, setResetting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      await signInWithEmail(email, password)
      navigate('/dashboard')
    } catch (err) {
      console.error('Login error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotPassword() {
    setError(null)
    setResetSent(false)

    if (!email) {
      setError('Enter your email above, then click "Forgot password?"')
      return
    }

    setResetting(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw error
      setResetSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>PF Sales CRM</h1>
        <p>Sales Lead Management</p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div className="error-message">{error}</div>}
          {resetSent && (
            <div className="error-message" style={{ background: '#f0fdf4', color: '#166534', borderColor: '#bbf7d0' }}>
              Password reset link sent. Check your inbox.
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <button
            type="button"
            onClick={handleForgotPassword}
            disabled={resetting}
            style={{
              background: 'none',
              border: 'none',
              color: '#3b82f6',
              fontSize: '0.875rem',
              marginTop: '0.75rem',
              cursor: 'pointer',
              textAlign: 'center',
              width: '100%',
            }}
          >
            {resetting ? 'Sending...' : 'Forgot password?'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <span style={{ color: '#9ca3af' }}>Don't have an account? </span>
          <Link to="/signup" style={{ color: '#3b82f6', textDecoration: 'none' }}>
            Create one
          </Link>
        </div>
      </div>
    </div>
  )
}

export default Login
