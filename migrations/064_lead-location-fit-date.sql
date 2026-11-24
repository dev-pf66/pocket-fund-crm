-- Add location, fit_score, and first_contact_date to crm_leads so CSV
-- imports can carry these fields alongside the existing lead profile fields.
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS location         VARCHAR(100);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS fit_score        INTEGER CHECK (fit_score >= 1 AND fit_score <= 5);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS first_contact_date DATE;
