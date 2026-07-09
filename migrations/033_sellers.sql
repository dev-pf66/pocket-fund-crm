-- ============================================
-- INDIAN SELLERS (buyside acquisition pipeline)
-- ============================================
-- Standalone kanban for Indian business sellers Kautilya is meeting with.
-- Deliberately NOT part of crm_leads: sellers are buyside acquisition
-- targets, not sales leads, and must stay out of the sales funnel, outreach
-- tracker, and dashboard conversion metrics.
--
-- Stages: sourced | contacted | intro_call | evaluating | loi_offer |
--         acquired | passed
--
-- RLS: team-shared. Any authenticated user sees and edits every seller
-- (this is a collaborative buyside pipeline, matching the open Investors
-- model — NOT the per-user Partners isolation).
--
-- Run in Supabase SQL Editor. Safe to run multiple times.

CREATE TABLE IF NOT EXISTS crm_sellers (
  id SERIAL PRIMARY KEY,

  -- Primary contact / owner of the business.
  name VARCHAR(200) NOT NULL,
  business_name VARCHAR(200),
  industry VARCHAR(120),
  location VARCHAR(120),

  -- sourced | contacted | intro_call | evaluating | loi_offer | acquired | passed
  stage VARCHAR(50) NOT NULL DEFAULT 'sourced',

  url TEXT,
  email VARCHAR(255),

  asking_price VARCHAR(100),
  revenue VARCHAR(100),

  meeting_date DATE,
  next_follow_up_date DATE,
  last_contact_date DATE,

  notes TEXT,

  assigned_to INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_sellers_stage ON crm_sellers(stage);
CREATE INDEX IF NOT EXISTS idx_crm_sellers_assigned_to ON crm_sellers(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_sellers_created_by ON crm_sellers(created_by);

-- updated_at trigger
CREATE OR REPLACE FUNCTION trigger_set_sellers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_crm_sellers_updated_at ON crm_sellers;
CREATE TRIGGER set_crm_sellers_updated_at
BEFORE UPDATE ON crm_sellers
FOR EACH ROW EXECUTE FUNCTION trigger_set_sellers_updated_at();

-- RLS — team-shared: any authenticated user has full access.
ALTER TABLE crm_sellers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_view_sellers" ON crm_sellers;
CREATE POLICY "team_view_sellers" ON crm_sellers
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "team_create_sellers" ON crm_sellers;
CREATE POLICY "team_create_sellers" ON crm_sellers
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "team_update_sellers" ON crm_sellers;
CREATE POLICY "team_update_sellers" ON crm_sellers
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "team_delete_sellers" ON crm_sellers;
CREATE POLICY "team_delete_sellers" ON crm_sellers
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Verification:
-- SELECT tablename, policyname FROM pg_policies WHERE tablename = 'crm_sellers';
