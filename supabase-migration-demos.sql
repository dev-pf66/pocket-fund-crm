-- ============================================
-- PE OS DEMOS
-- ============================================
-- Tracks demo calls for PE OS. Each demo links to a crm_leads row so the
-- person carries their outreach → demo → eventual sale history in one
-- place. The demo lifecycle (scheduled / done / signed_up / passed) lives
-- here, separate from the sales pipeline stage on the lead.
--
-- RLS: per-user, mirrors partners/leads/outreach. Admins see everyone.
-- Run in Supabase SQL Editor. Safe to run multiple times.

CREATE TABLE IF NOT EXISTS crm_demos (
  id SERIAL PRIMARY KEY,

  -- The lead this demo is with. Required — every demo is a conversation
  -- with someone who already exists as a lead. Cascade so deleting the
  -- lead cleans up its demos.
  lead_id INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,

  -- scheduled | done | signed_up | passed
  stage VARCHAR(50) NOT NULL DEFAULT 'scheduled',

  -- The actual call date (or scheduled date when stage = 'scheduled').
  demo_date DATE,

  -- Free-form fields captured during/after the demo. transcript can be
  -- inline text or a URL to an external doc — we don't enforce.
  transcript TEXT,
  feedback TEXT,
  use_case TEXT,
  decision_maker VARCHAR(200),
  team_size VARCHAR(50),
  next_steps TEXT,
  notes TEXT,

  created_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_demos_lead_id ON crm_demos(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_demos_stage ON crm_demos(stage);
CREATE INDEX IF NOT EXISTS idx_crm_demos_created_by ON crm_demos(created_by);
CREATE INDEX IF NOT EXISTS idx_crm_demos_demo_date ON crm_demos(demo_date);

-- updated_at trigger
CREATE OR REPLACE FUNCTION trigger_set_demos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_crm_demos_updated_at ON crm_demos;
CREATE TRIGGER set_crm_demos_updated_at
BEFORE UPDATE ON crm_demos
FOR EACH ROW EXECUTE FUNCTION trigger_set_demos_updated_at();

-- RLS — depends on the helper functions added by
-- supabase-migration-per-user-isolation.sql.
ALTER TABLE crm_demos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_view_own_demos" ON crm_demos;
CREATE POLICY "users_view_own_demos" ON crm_demos
  FOR SELECT
  USING (current_user_is_admin() OR created_by = current_person_id());

DROP POLICY IF EXISTS "users_create_demos" ON crm_demos;
CREATE POLICY "users_create_demos" ON crm_demos
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      current_user_is_admin()
      OR created_by = current_person_id()
      OR created_by IS NULL
    )
  );

DROP POLICY IF EXISTS "users_update_own_demos" ON crm_demos;
CREATE POLICY "users_update_own_demos" ON crm_demos
  FOR UPDATE
  USING (current_user_is_admin() OR created_by = current_person_id());

DROP POLICY IF EXISTS "users_delete_own_demos" ON crm_demos;
CREATE POLICY "users_delete_own_demos" ON crm_demos
  FOR DELETE
  USING (current_user_is_admin() OR created_by = current_person_id());

-- Verification:
-- SELECT tablename, policyname FROM pg_policies WHERE tablename = 'crm_demos';
