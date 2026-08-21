// Several modules under test build a Supabase client at import time, which
// throws if the key is absent. These are placeholders so the module graph
// loads — no test here ever reaches the network; the DB is faked
// (test/helpers/fake-supabase.js) or bypassed entirely by testing pure
// functions. Real values would be a mistake, not an improvement.

const PLACEHOLDERS = {
  VITE_SUPABASE_URL: 'http://localhost:54321',
  VITE_SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  CRM_API_KEY: 'test-crm-key',
  CRON_SECRET: 'test-cron-secret',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  TASK_TRACKER_API_URL: 'http://localhost:9999/api/sage',
  TASK_TRACKER_API_KEY: 'test-tt-key'
}

for (const [key, value] of Object.entries(PLACEHOLDERS)) {
  if (!process.env[key]) process.env[key] = value
}
