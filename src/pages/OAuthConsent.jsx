import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// The consent screen for Supabase Auth's OAuth server — what a user sees when
// they connect the CRM's MCP server (/api/mcp) from claude.ai or any other MCP
// client. Supabase redirects here with ?authorization_id=…; approving hands
// the client a token scoped to the signed-in user. See api/_mcp-auth.js.
//
// Rendered outside Layout and reachable signed-out (App.jsx shows Login on
// this same URL, then lands back here), so the authorization_id survives the
// sign-in.
function OAuthConsent() {
  const [params] = useSearchParams()
  const authorizationId = params.get('authorization_id')
  const [details, setDetails] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!authorizationId) return
    supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (error) return setError(error.message)
      // Already approved this client before — Supabase hands back the
      // redirect straight away, no need to ask again.
      if (data?.redirect_url) return window.location.assign(data.redirect_url)
      setDetails(data)
    })
  }, [authorizationId])

  async function decide(approve) {
    setSubmitting(true)
    setError(null)
    const fn = approve ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization
    const { data, error } = await fn.call(supabase.auth.oauth, authorizationId, { skipBrowserRedirect: true })
    if (error) {
      setSubmitting(false)
      return setError(error.message)
    }
    window.location.assign(data.redirect_url)
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>PF Sales CRM</h1>
        {!authorizationId && (
          <div className="error-message">
            Missing authorization_id. Start the connection again from the app you are connecting.
          </div>
        )}
        {authorizationId && !details && !error && <p>Loading…</p>}
        {details && (
          <>
            <p>
              <strong>{details.client?.name || 'An application'}</strong> wants to access the CRM as{' '}
              <strong>{details.user?.email}</strong>.
            </p>
            <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>
              It will be able to read and update leads, activities, investors, partners and tags — the same
              things you can do in the app. You can revoke it from the connector's settings.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button className="btn btn-primary" disabled={submitting} onClick={() => decide(true)}>
                {submitting ? 'Working…' : 'Allow'}
              </button>
              <button className="btn" disabled={submitting} onClick={() => decide(false)}>
                Deny
              </button>
            </div>
          </>
        )}
        {error && <div className="error-message">{error}</div>}
      </div>
    </div>
  )
}

export default OAuthConsent
