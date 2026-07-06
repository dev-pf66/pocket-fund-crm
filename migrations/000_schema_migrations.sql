-- Migration tracking table. Idempotent — safe to run multiple times.
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
