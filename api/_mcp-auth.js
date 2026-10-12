import { fetchAllRows } from './_db.js'
import { findPersonByEmail } from '../src/lib/identity.js'

// Auth for the remote MCP server at /api/mcp (Oct 2026).
//
// The first cut of /api/mcp accepted only the x-api-key header — and a
// claude.ai custom connector CANNOT send a custom header. It speaks OAuth or
// nothing. So claude.ai got a bare 401, went looking for OAuth metadata at
// /.well-known/oauth-protected-resource and /.well-known/oauth-authorization-
// server, received the SPA's index.html with HTTP 200 from the catch-all
// rewrite (the HTML-shell trap), then tried dynamic client registration at
// /register — more HTML — and gave up with "Couldn't register with Pocket Fund
// CRM's sign-in service". The connector never worked from claude.ai; the
// end-to-end check that shipped it used curl with the API key.
//
// The fix does NOT build an OAuth server here. Supabase Auth ships one (OAuth
// 2.1 + PKCE + dynamic client registration), and every CRM user already has a
// Supabase login. So:
//   1. /.well-known/oauth-protected-resource (served below) tells the MCP
//      client the authorization server is this project's Supabase Auth.
//   2. Supabase sends the user to /oauth/consent in the SPA
//      (src/pages/OAuthConsent.jsx) to sign in and approve.
//   3. The access token Supabase issues is an ordinary Supabase user JWT, so
//      /api/mcp verifies it with auth.getUser — same as api/_auth.js does for
//      the AI endpoints.
//
// Prerequisite that lives outside the code: Supabase dashboard →
// Authentication → OAuth Server must be ENABLED, with dynamic client
// registration allowed and the authorization path set to /oauth/consent.
// While it is off, Supabase answers its own metadata URL with
// "feature_disabled" and claude.ai still fails at registration.

function origin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const proto = req.headers['x-forwarded-proto'] || 'https'
  return `${proto}://${host}`
}

export function resourceMetadataUrl(req) {
  return `${origin(req)}/.well-known/oauth-protected-resource`
}

// RFC 9728 protected-resource metadata. `resource` must equal the URL the
// connector was configured with, or a spec-following client refuses the token.
export function handleProtectedResourceMetadata(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300')
  return res.status(200).json({
    resource: `${origin(req)}/api/mcp`,
    authorization_servers: [`${process.env.VITE_SUPABASE_URL}/auth/v1`],
    bearer_methods_supported: ['header'],
    resource_name: 'Pocket Fund CRM',
  })
}

// The WWW-Authenticate header is what starts discovery. Without it a client
// has to guess where the metadata lives — which is how claude.ai ended up
// reading index.html.
export function mcpUnauthorized(req, res, message) {
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl(req)}"`)
  return res.status(401).json({
    error: message || 'Unauthorized. Connect via OAuth (sign in with your CRM account) or send a valid x-api-key header.',
  })
}

/**
 * Who may call /api/mcp. Returns { ok: true } or { ok: false, status?, message? }.
 *
 * - x-api-key: the existing shared key, for agents and scripts.
 * - Authorization: Bearer <Supabase JWT>: a CRM user, via the OAuth flow.
 *   The user must also map to a NON-archived `people` row — the app bounces
 *   archived accounts (App.jsx), and the MCP tools run on the service-role
 *   client, so letting an archived login in here would hand them more access
 *   than the app itself does. Matched case-insensitively via
 *   findPersonByEmail, the same rule RLS and the app use.
 */
export async function authorizeMcp(req, supabase) {
  const validKey = process.env.CRM_API_KEY
  if (validKey && req.headers['x-api-key'] === validKey) return { ok: true }

  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!auth?.startsWith('Bearer ')) return { ok: false }

  let user
  try {
    const { data, error } = await supabase.auth.getUser(auth.slice(7))
    if (error || !data?.user) return { ok: false, message: 'Invalid or expired token. Reconnect the connector.' }
    user = data.user
  } catch {
    return { ok: false, message: 'Invalid or expired token. Reconnect the connector.' }
  }

  const people = await fetchAllRows(() => supabase.from('people').select('id, email, is_archived').order('id'))
  const person = findPersonByEmail(people, user.email)
  // 403, not 401: the token is fine, and re-running OAuth would not change
  // the answer — a 401 would send the client round the sign-in loop forever.
  if (!person) return { ok: false, status: 403, message: 'This login has no CRM profile. Sign in to the CRM app once, then reconnect.' }
  if (person.is_archived) return { ok: false, status: 403, message: 'This CRM account is archived.' }
  return { ok: true }
}
