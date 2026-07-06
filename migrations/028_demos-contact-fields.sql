-- ============================================
-- PE OS DEMOS — contact fields
-- ============================================
-- Capture the actual person on the demo call: their name, firm, and
-- designation/title. These are distinct from the linked lead (which may
-- be the firm-level record) so a demo can name the specific attendee.

ALTER TABLE crm_demos
  ADD COLUMN IF NOT EXISTS contact_name VARCHAR(200);

ALTER TABLE crm_demos
  ADD COLUMN IF NOT EXISTS contact_firm VARCHAR(200);

ALTER TABLE crm_demos
  ADD COLUMN IF NOT EXISTS designation VARCHAR(150);
