// Config + automation health check.
//
// Answers the two questions that used to take months to answer: "is every env
// var this deployment needs actually set?" and "when did the cron last run?"
// Reports env var NAMES and presence only — never values.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     https://pocket-fund-crm.vercel.app/api/health

import { createClient } from '@supabase/supabase-js'
import { missingEnv } from './_env.js'

// Everything any handler in api/ needs, in one place.
const REQUIRED = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRM_API_KEY',
  'CRON_SECRET',
  'ANTHROPIC_API_KEY',
  'TASK_TRACKER_API_URL',
  'TASK_TRACKER_API_KEY'
]

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const missing = missingEnv(REQUIRED)

  let lastDigestRun = null
  let dbError = null
  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    const { data, error } = await supabase
      .from('crm_cron_runs')
      .select('run_key, status, detail, ran_at')
      .eq('job', 'weekly-digest')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    lastDigestRun = data
  } catch (e) {
    dbError = e.message
  }

  const healthy = missing.length === 0 && !dbError
  return res.status(healthy ? 200 : 503).json({
    ok: healthy,
    env: { required: REQUIRED.length, missing },
    weekly_digest: { last_run: lastDigestRun, db_error: dbError },
    checked_at: new Date().toISOString()
  })
}
