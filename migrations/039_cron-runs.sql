-- 039: Cron heartbeat log.
--
-- The weekly digest's entire failure history is "died silently" — it was dead
-- for months because TASK_TRACKER_* were missing from Vercel prod and nothing
-- anywhere recorded that a run had been attempted and failed. Every run now
-- writes a row here (ok or failed), so "did the automation run?" is a query
-- instead of an archaeology exercise.
--
-- Service-role writes only; no RLS policy for anon/authenticated on purpose.
-- Idempotent.

CREATE TABLE IF NOT EXISTS crm_cron_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job         text NOT NULL,                 -- e.g. 'weekly-digest'
  run_key     text,                          -- logical period, e.g. the week's Monday
  status      text NOT NULL,                 -- 'ok' | 'failed' | 'skipped'
  detail      text,                          -- error message or a short note
  ran_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_cron_runs_job_ran_at_idx
  ON crm_cron_runs (job, ran_at DESC);

ALTER TABLE crm_cron_runs ENABLE ROW LEVEL SECURITY;
