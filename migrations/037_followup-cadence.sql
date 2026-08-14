-- ============================================
-- FOLLOW-UP REMINDERS + REUSABLE CADENCES
-- ============================================
-- crm_leads already had next_follow_up_date (migration 001) and the Today tab
-- reads it, but nothing recorded WHY a reach-out was scheduled and every date
-- had to be set by hand, one touch at a time.
--
-- This adds:
--   crm_leads.follow_up_note     — the "when you come back, say this" line
--   crm_leads.follow_up_cadence  — state for a multi-touch cadence:
--       { name, offsets: [3,10,30], step: 1, anchor: 'YYYY-MM-DD' }
--     step = how many offsets have been scheduled so far; anchor = the day the
--     cadence was applied. Advancing is pure arithmetic (anchor + offsets[step]),
--     so a lead that gets touched early still lands on the right next date.
--   crm_followup_cadences        — the reusable, shared cadence library
--
-- RLS on crm_followup_cadences is deliberately allow-all (mirrors
-- crm_investors / crm_partners): the cadence library is a shared team asset.
--
-- Run via the /migrate skill. Idempotent.

ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS follow_up_note TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS follow_up_cadence JSONB;

CREATE TABLE IF NOT EXISTS crm_followup_cadences (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  offsets     INTEGER[] NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index: the notification bell and Today tab both query
-- "assigned to me AND due on/before today AND still workable".
CREATE INDEX IF NOT EXISTS idx_crm_leads_followup_due
  ON crm_leads(assigned_to, next_follow_up_date)
  WHERE next_follow_up_date IS NOT NULL;

ALTER TABLE crm_followup_cadences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access to crm_followup_cadences" ON crm_followup_cadences;
CREATE POLICY "Allow all access to crm_followup_cadences" ON crm_followup_cadences
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Seed the starting library. ON CONFLICT keeps re-runs (and any edits the team
-- has since made to these rows) safe.
INSERT INTO crm_followup_cadences (name, description, offsets) VALUES
  ('Standard (3 / 10 / 30)', 'Default nudge cadence for an engaged lead',        ARRAY[3, 10, 30]),
  ('Aggressive (2 / 5 / 9)', 'Hot lead — stay on them',                          ARRAY[2, 5, 9]),
  ('Slow burn (30 / 90)',    'Not now, but worth a check-in next quarter',       ARRAY[30, 90])
ON CONFLICT (name) DO NOTHING;

-- Verification:
-- SELECT name, offsets FROM crm_followup_cadences ORDER BY id;
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'crm_leads' AND column_name LIKE 'follow_up%';
