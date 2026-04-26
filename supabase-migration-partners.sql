-- ============================================
-- POTENTIAL PARTNERS
-- ============================================
-- Personal kanban for tracking potential partners (creators, communities,
-- investors, funds, podcasts, media, competitors, adjacent industry).
--
-- RLS: each user only sees their own rows. Admins (people.is_admin = true)
-- keep full access, matching the leads/outreach pattern.
--
-- Run in Supabase SQL Editor. Safe to run multiple times.

CREATE TABLE IF NOT EXISTS crm_partners (
  id SERIAL PRIMARY KEY,

  name VARCHAR(200) NOT NULL,
  -- Any of: creator, community, investor, fund, podcast, media, competitor,
  -- adjacent_industry. A partner can belong to several at once.
  categories TEXT[] NOT NULL DEFAULT '{}',
  -- potential | reached_out | in_conversation | active_partner | passed
  stage VARCHAR(50) NOT NULL DEFAULT 'potential',

  url TEXT,
  email VARCHAR(255),
  handle VARCHAR(200),
  audience_size VARCHAR(100),
  notes TEXT,

  next_follow_up_date DATE,
  last_contact_date DATE,

  created_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_partners_created_by ON crm_partners(created_by);
CREATE INDEX IF NOT EXISTS idx_crm_partners_stage ON crm_partners(stage);
CREATE INDEX IF NOT EXISTS idx_crm_partners_categories ON crm_partners USING GIN (categories);

-- updated_at trigger
CREATE OR REPLACE FUNCTION trigger_set_partners_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_crm_partners_updated_at ON crm_partners;
CREATE TRIGGER set_crm_partners_updated_at
BEFORE UPDATE ON crm_partners
FOR EACH ROW EXECUTE FUNCTION trigger_set_partners_updated_at();

-- RLS
ALTER TABLE crm_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_view_own_partners" ON crm_partners;
CREATE POLICY "users_view_own_partners" ON crm_partners
  FOR SELECT
  USING (current_user_is_admin() OR created_by = current_person_id());

DROP POLICY IF EXISTS "users_create_partners" ON crm_partners;
CREATE POLICY "users_create_partners" ON crm_partners
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      current_user_is_admin()
      OR created_by = current_person_id()
      OR created_by IS NULL
    )
  );

DROP POLICY IF EXISTS "users_update_own_partners" ON crm_partners;
CREATE POLICY "users_update_own_partners" ON crm_partners
  FOR UPDATE
  USING (current_user_is_admin() OR created_by = current_person_id());

DROP POLICY IF EXISTS "users_delete_own_partners" ON crm_partners;
CREATE POLICY "users_delete_own_partners" ON crm_partners
  FOR DELETE
  USING (current_user_is_admin() OR created_by = current_person_id());

-- Verification:
-- SELECT tablename, policyname FROM pg_policies WHERE tablename = 'crm_partners';
