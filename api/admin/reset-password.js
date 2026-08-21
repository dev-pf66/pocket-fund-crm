import { createClient } from '@supabase/supabase-js'
import { requireEnv } from '../_env.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const admin = createClient(supabaseUrl, supabaseServiceKey)

// Bootstrap admin so dev@pocket-fund.com works even if is_admin somehow
// isn't seeded. Same check as the frontend's isAdminUser helper.
const BOOTSTRAP_ADMIN_EMAIL = 'dev@pocket-fund.com'

async function authenticate(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const anon = createClient(supabaseUrl, supabaseAnon)
  const { data, error } = await anon.auth.getUser(token)
  if (error || !data?.user?.email) return null
  const { data: person } = await admin
    .from('people')
    .select('id, name, email, is_admin')
    .eq('email', data.user.email)
    .maybeSingle()
  return person
    ? { ...person, isAdmin: person.is_admin || person.email === BOOTSTRAP_ADMIN_EMAIL }
    : { id: null, email: data.user.email, isAdmin: data.user.email === BOOTSTRAP_ADMIN_EMAIL }
}

// Find a Supabase auth user by email. Paginates through listUsers since
// there's no direct getUserByEmail. Stops as soon as we find a match.
async function findAuthUserByEmail(email) {
  const lower = email.toLowerCase()
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const found = data.users.find(u => (u.email || '').toLowerCase() === lower)
    if (found) return found
    if (!data.users || data.users.length < 1000) return null
    page += 1
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  if (!requireEnv(res, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])) return

  const actor = await authenticate(req)
  if (!actor) return res.status(401).json({ error: 'Unauthorized' })
  if (!actor.isAdmin) return res.status(403).json({ error: 'Admin only' })

  const { target_email, new_password } = req.body || {}
  if (!target_email) return res.status(400).json({ error: 'target_email required' })
  if (!new_password || String(new_password).length < 8) {
    return res.status(400).json({ error: 'new_password required (min 8 chars)' })
  }
  if (String(target_email).toLowerCase() === String(actor.email).toLowerCase()) {
    return res.status(400).json({ error: 'Use the normal flow to change your own password' })
  }

  try {
    const targetUser = await findAuthUserByEmail(target_email)
    if (!targetUser) return res.status(404).json({ error: `No auth user found for ${target_email}` })

    const { error: updErr } = await admin.auth.admin.updateUserById(targetUser.id, { password: new_password })
    if (updErr) throw updErr

    return res.status(200).json({ ok: true, email: targetUser.email })
  } catch (e) {
    console.error('admin/reset-password error:', e)
    return res.status(500).json({ error: e.message })
  }
}
