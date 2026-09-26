-- ============================================
-- ARCHIVING LEADS
-- ============================================
-- The pipeline had accumulated 1,122 leads, ~300 of them untouched for more
-- than 90 days. They are not wrong, they are just over — they pad every stage
-- count, they dilute the notification feed, and they make "171 people replied
-- to us" read as a backlog nobody can work.
--
-- Archiving mirrors people.is_archived (migration 029) exactly: the row is
-- fully retained, it just stops showing up in the working surfaces. Nothing
-- is ever deleted, and un-archiving is a single flag flip — which is why
-- archived_at and archived_reason are recorded: a bulk sweep has to be
-- auditable and reversible in practice, not merely in principle.
--
-- Enforced at the app layer (getLeads and the notification feed filter it
-- out), same as the people archive. RLS is untouched.
--
-- Run via the /migrate skill. Idempotent.

ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS archived_reason TEXT;

-- Partial index: every working surface now asks "not archived", and the
-- archived set is the small side of that split.
CREATE INDEX IF NOT EXISTS idx_crm_leads_is_archived
  ON crm_leads(is_archived) WHERE is_archived = true;

-- The notification feed's heaviest query is "engaged, not archived, ordered
-- by how long it has been quiet".
CREATE INDEX IF NOT EXISTS idx_crm_leads_active_stage_activity
  ON crm_leads(stage, last_activity_date) WHERE is_archived = false;

-- Verification:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'crm_leads' AND column_name LIKE 'archived%' OR column_name = 'is_archived';
-- SELECT is_archived, count(*) FROM crm_leads GROUP BY is_archived;
