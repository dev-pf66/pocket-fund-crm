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
  'TASK_TRACKER_API_KEY',
  'CALLHIPPO_API_TOKEN'
]

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const missing = missingEnv(REQUIRED)

  let lastDigestRun = null
  let lastCallSync = null
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

    // The CallHippo sync is the one job where silence destroys data: their
    // plan drops call logs after a month, so a cron that quietly stops loses
    // calls permanently rather than merely delaying them. Report its age.
    const { data: sync, error: syncErr } = await supabase
      .from('crm_cron_runs')
      .select('run_key, status, detail, ran_at')
      .eq('job', 'callhippo-sync')
      .eq('status', 'ok')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (syncErr) throw syncErr
    lastCallSync = sync
  } catch (e) {
    dbError = e.message
  }

  // Stale after 2 days: the job runs daily, so one missed night is noise and
  // two is a pattern. Severe at 25 — past that we are inside the margin where
  // CallHippo starts deleting calls we never collected.
  const syncAgeDays = lastCallSync?.ran_at
    ? Math.floor((Date.now() - Date.parse(lastCallSync.ran_at)) / 86400000)
    : null
  const callSyncStale = syncAgeDays == null || syncAgeDays >= 2
  const callSyncCritical = syncAgeDays == null || syncAgeDays >= 25

  // A stale call sync makes the deployment unhealthy, not merely noteworthy —
  // it is losing data every day it stays down, and a 200 here would be exactly
  // the plausible-looking no-op this endpoint exists to prevent.
  const healthy = missing.length === 0 && !dbError && !callSyncCritical
  return res.status(healthy ? 200 : 503).json({
    ok: healthy,
    env: { required: REQUIRED.length, missing },
    weekly_digest: { last_run: lastDigestRun, db_error: dbError },
    callhippo_sync: {
      last_ok_run: lastCallSync,
      age_days: syncAgeDays,
      stale: callSyncStale,
      critical: callSyncCritical,
      note: callSyncCritical
        ? 'CallHippo deletes call logs after ~30 days. Calls may already be lost. Run: curl -H "Authorization: Bearer $CRON_SECRET" https://pocket-fund-crm.vercel.app/api/callhippo-sync'
        : undefined
    },
    checked_at: new Date().toISOString()
  })
}
