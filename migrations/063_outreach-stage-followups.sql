-- Add followup_1 and followup_2 to the outreach_stage CHECK constraint on crm_leads.
-- The existing constraint must be dropped and replaced because Postgres CHECK constraints
-- cannot be altered in place.
ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS crm_leads_outreach_stage_check;
ALTER TABLE crm_leads ADD CONSTRAINT crm_leads_outreach_stage_check
  CHECK (outreach_stage IN ('cold', 'messaged', 'followup_1', 'followup_2', 'replied', 'meeting'));
