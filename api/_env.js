// Required-env guard for the serverless functions.
//
// Every silent-automation outage this repo has had traced back to a missing
// env var: TASK_TRACKER_API_URL/KEY were absent from Vercel prod for months
// and killed all task-tracker automation without ever raising an error, and
// an unset CRM_API_KEY turned the api-key check into `undefined === undefined`
// and opened the service-role client to anyone. The rule now is: a handler
// whose config is missing fails loudly on the first request instead of
// degrading into a plausible-looking no-op.

export function missingEnv(names) {
  return names.filter((n) => !process.env[n])
}

/**
 * Guard a handler. Returns true when every name is set; otherwise logs which
 * vars are missing and writes a deliberately vague 500, then returns false —
 * so call sites read:
 *
 *   if (!requireEnv(res, ['VITE_SUPABASE_URL', 'CRM_API_KEY'])) return
 *
 * This runs BEFORE the auth check (a misconfigured auth check is exactly what
 * it's guarding against), so the response must not tell an unauthenticated
 * caller anything about the deployment. The var names go to the Vercel log,
 * and to `GET /api/health` — which is behind CRON_SECRET.
 */
export function requireEnv(res, names) {
  const missing = missingEnv(names)
  if (missing.length === 0) return true
  console.error(`[config] missing required env: ${missing.join(', ')}`)
  res.status(500).json({
    success: false,
    error: 'Server misconfigured — see /api/health'
  })
  return false
}
