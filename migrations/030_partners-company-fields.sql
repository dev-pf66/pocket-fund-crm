-- ============================================
-- PARTNERS — company / industry / linkedin
-- ============================================
-- Capture more context on a potential partner: their company/org name,
-- industry, and a dedicated LinkedIn URL (distinct from the generic `url`
-- field which is often a channel / website link).

ALTER TABLE crm_partners
  ADD COLUMN IF NOT EXISTS company_name VARCHAR(200);

ALTER TABLE crm_partners
  ADD COLUMN IF NOT EXISTS industry VARCHAR(150);

ALTER TABLE crm_partners
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
