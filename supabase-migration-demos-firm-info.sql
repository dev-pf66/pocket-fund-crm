-- ============================================
-- PE OS DEMOS — firm/team size + keenness
-- ============================================
-- Adds structured "basic info on the lead" fields to crm_demos so the
-- kanban cards can surface signal without scanning use_case text.
--
-- firm_size and team_size stay free-form VARCHAR (UI uses a set of
-- canned options but admins may want to write something else later).
-- keenness is a 1-5 integer with a CHECK constraint so we can render
-- it as a fixed scale.

ALTER TABLE crm_demos
  ADD COLUMN IF NOT EXISTS firm_size VARCHAR(50);

-- team_size already exists as VARCHAR(50); the UI is switching to a
-- dropdown but the column type is fine as-is.

ALTER TABLE crm_demos
  ADD COLUMN IF NOT EXISTS keenness INTEGER
  CHECK (keenness IS NULL OR keenness BETWEEN 1 AND 5);
