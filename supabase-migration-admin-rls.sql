-- Admin RLS + FK fixes so the Remove / Make Admin actions actually work.
-- Self-contained — also adds the is_admin column if it's missing.
-- Run in Supabase SQL Editor. Safe to run multiple times.

-- ---------------------------------------------------------------------------
-- 0. Ensure is_admin column exists and seed the bootstrap admin
-- ---------------------------------------------------------------------------

ALTER TABLE people
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

UPDATE people SET is_admin = true WHERE email = 'dev@pocket-fund.com';

CREATE INDEX IF NOT EXISTS idx_people_is_admin ON people(is_admin) WHERE is_admin = true;

-- ---------------------------------------------------------------------------
-- 1. RLS policies: admins can update and delete any person
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "admins_can_update_people" ON people;
CREATE POLICY "admins_can_update_people" ON people
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM people me
    WHERE me.email = (SELECT auth.jwt() ->> 'email')
      AND me.is_admin = true
  ));

DROP POLICY IF EXISTS "admins_can_delete_people" ON people;
CREATE POLICY "admins_can_delete_people" ON people
  FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM people me
    WHERE me.email = (SELECT auth.jwt() ->> 'email')
      AND me.is_admin = true
  ));

-- ---------------------------------------------------------------------------
-- 2. FK cascades: preserve history when a user is removed.
--    SET NULL clears the person reference on historical rows (leads,
--    activities, etc.) so the delete succeeds without blowing away data.
-- ---------------------------------------------------------------------------

ALTER TABLE IF EXISTS crm_leads DROP CONSTRAINT IF EXISTS crm_leads_created_by_fkey;
ALTER TABLE IF EXISTS crm_leads ADD CONSTRAINT crm_leads_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES people(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS crm_lead_activities DROP CONSTRAINT IF EXISTS crm_lead_activities_logged_by_fkey;
ALTER TABLE IF EXISTS crm_lead_activities ADD CONSTRAINT crm_lead_activities_logged_by_fkey
  FOREIGN KEY (logged_by) REFERENCES people(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS crm_sample_deals DROP CONSTRAINT IF EXISTS crm_sample_deals_created_by_fkey;
ALTER TABLE IF EXISTS crm_sample_deals ADD CONSTRAINT crm_sample_deals_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES people(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS crm_outreach_log DROP CONSTRAINT IF EXISTS crm_outreach_log_logged_by_fkey;
ALTER TABLE IF EXISTS crm_outreach_log ADD CONSTRAINT crm_outreach_log_logged_by_fkey
  FOREIGN KEY (logged_by) REFERENCES people(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS crm_email_templates DROP CONSTRAINT IF EXISTS crm_email_templates_created_by_fkey;
ALTER TABLE IF EXISTS crm_email_templates ADD CONSTRAINT crm_email_templates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES people(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS crm_help_articles DROP CONSTRAINT IF EXISTS crm_help_articles_last_updated_by_fkey;
ALTER TABLE IF EXISTS crm_help_articles ADD CONSTRAINT crm_help_articles_last_updated_by_fkey
  FOREIGN KEY (last_updated_by) REFERENCES people(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS crm_transcripts DROP CONSTRAINT IF EXISTS crm_transcripts_created_by_fkey;
ALTER TABLE IF EXISTS crm_transcripts ADD CONSTRAINT crm_transcripts_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES people(id) ON DELETE SET NULL;
