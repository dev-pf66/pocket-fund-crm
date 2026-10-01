-- ============================================
-- ITALY PIPELINE (mixed-ecosystem buyside pipeline)
-- ============================================
-- Standalone kanban for the Italy effort. Unlike crm_sellers (Indian sellers
-- only), this pipeline is deliberately mixed: sellers, buyers, brokers, and
-- other ecosystem contacts (lawyers, advisors, intros — whatever doesn't fit
-- the other three) all live in one board, distinguished by contact_type.
--
-- Deliberately NOT part of crm_leads, same reasoning as crm_sellers: these
-- are buyside acquisition-ecosystem contacts, not sales leads, and must stay
-- out of the sales funnel, outreach tracker, and dashboard conversion
-- metrics.
--
-- contact_type: seller | buyer | broker | other
-- Stages (generic on purpose — "Acquired" doesn't fit a broker):
--   sourced | contacted | engaged | active | closed | passed
--
-- RLS: team-shared, matching crm_sellers — any authenticated user sees and
-- edits every row (collaborative buyside pipeline, not per-user isolation).
--
-- Run in Supabase SQL Editor, or via `supabase db push` per the /migrate
-- skill. Safe to run multiple times.

CREATE TABLE IF NOT EXISTS crm_italy_pipeline (
  id SERIAL PRIMARY KEY,

  -- Primary contact.
  name VARCHAR(200) NOT NULL,

  -- seller | buyer | broker | other
  contact_type VARCHAR(20) NOT NULL DEFAULT 'seller'
    CHECK (contact_type IN ('seller', 'buyer', 'broker', 'other')),

  company_name VARCHAR(200),
  industry VARCHAR(120),
  location VARCHAR(120),

  -- sourced | contacted | engaged | active | closed | passed
  stage VARCHAR(50) NOT NULL DEFAULT 'sourced',

  url TEXT,
  email VARCHAR(255),

  -- Free text on purpose, like crm_sellers: an asking price for a seller, a
  -- budget for a buyer, a typical deal size for a broker — one column, read
  -- in context of contact_type.
  deal_value VARCHAR(100),
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

CREATE INDEX IF NOT EXISTS idx_crm_italy_pipeline_stage ON crm_italy_pipeline(stage);
CREATE INDEX IF NOT EXISTS idx_crm_italy_pipeline_contact_type ON crm_italy_pipeline(contact_type);
CREATE INDEX IF NOT EXISTS idx_crm_italy_pipeline_assigned_to ON crm_italy_pipeline(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_italy_pipeline_created_by ON crm_italy_pipeline(created_by);

-- updated_at trigger
CREATE OR REPLACE FUNCTION trigger_set_italy_pipeline_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_crm_italy_pipeline_updated_at ON crm_italy_pipeline;
CREATE TRIGGER set_crm_italy_pipeline_updated_at
BEFORE UPDATE ON crm_italy_pipeline
FOR EACH ROW EXECUTE FUNCTION trigger_set_italy_pipeline_updated_at();

-- RLS — team-shared: any authenticated user has full access.
ALTER TABLE crm_italy_pipeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_view_italy_pipeline" ON crm_italy_pipeline;
CREATE POLICY "team_view_italy_pipeline" ON crm_italy_pipeline
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "team_create_italy_pipeline" ON crm_italy_pipeline;
CREATE POLICY "team_create_italy_pipeline" ON crm_italy_pipeline
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "team_update_italy_pipeline" ON crm_italy_pipeline;
CREATE POLICY "team_update_italy_pipeline" ON crm_italy_pipeline
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "team_delete_italy_pipeline" ON crm_italy_pipeline;
CREATE POLICY "team_delete_italy_pipeline" ON crm_italy_pipeline
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Verification:
-- SELECT tablename, policyname FROM pg_policies WHERE tablename = 'crm_italy_pipeline';
