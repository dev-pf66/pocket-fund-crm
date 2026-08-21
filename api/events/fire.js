import { createClient } from '@supabase/supabase-js'
import { onOutreachLogged, onLeadStageChanged, onManualTaskCreate } from '../../src/lib/integrations/task-tracker.js'
import { requireEnv } from '../_env.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const admin = createClient(supabaseUrl, supabaseServiceKey)

async function authenticate(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const anon = createClient(supabaseUrl, supabaseAnon)
  const { data, error } = await anon.auth.getUser(token)
  if (error || !data?.user?.email) return null
  const { data: person } = await admin.from('people').select('id, name, email').eq('email', data.user.email).maybeSingle()
  return person || { id: null, email: data.user.email }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  // TASK_TRACKER_* were absent from Vercel prod for months, which silently
  // disabled every task-tracker side effect fired through here.
  if (!requireEnv(res, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'TASK_TRACKER_API_URL', 'TASK_TRACKER_API_KEY'])) return

  const actor = await authenticate(req)
  if (!actor) return res.status(401).json({ error: 'Unauthorized' })

  const { event_type, payload } = req.body || {}
  if (!event_type) return res.status(400).json({ error: 'event_type required' })

  try {
    let result
    switch (event_type) {
      case 'outreach_logged':
        // logged_by comes from the authenticated actor, never the request
        // body. It used to be taken straight from the client, so any
        // signed-in user could post someone else's person id and complete
        // THEIR daily-outreach subtask in the task tracker. The other two
        // branches already used actor.id.
        result = await onOutreachLogged({ outreach: { ...payload, logged_by: actor.id } })
        break
      case 'lead_stage_changed':
        result = await onLeadStageChanged({
          lead: payload.lead, oldStage: payload.oldStage, actorPersonId: actor.id
        })
        break
      case 'create_manual_task':
        result = await onManualTaskCreate({ payload, actorPersonId: actor.id })
        break
      default:
        return res.status(400).json({ error: `Unknown event_type: ${event_type}` })
    }
    return res.status(200).json({ ok: true, result })
  } catch (e) {
    console.error('events/fire error:', e)
    return res.status(500).json({ error: e.message })
  }
}
