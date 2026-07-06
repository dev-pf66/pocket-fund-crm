-- ============================================
-- OUTREACH LOG — linkedin_url
-- ============================================
-- Capture the contact's LinkedIn profile on an outreach entry (mappable in
-- the CSV upload), so imported rows carry the LinkedIn link alongside
-- lead_name / firm_name.

ALTER TABLE crm_outreach_log
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
