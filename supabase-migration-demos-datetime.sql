-- ============================================
-- PE OS DEMOS — call time
-- ============================================
-- Adds demo_datetime so scheduled calls can carry the actual call time
-- (date + time of day, with timezone) — needed for upcoming-call display
-- in IST. demo_date stays as a fallback for entries without a known time.

ALTER TABLE crm_demos
  ADD COLUMN IF NOT EXISTS demo_datetime TIMESTAMP WITH TIME ZONE;

-- Backfill: for existing rows that only have a date, leave demo_datetime
-- null — we don't know the time. The UI falls back to demo_date in that
-- case.

CREATE INDEX IF NOT EXISTS idx_crm_demos_demo_datetime
  ON crm_demos(demo_datetime);
