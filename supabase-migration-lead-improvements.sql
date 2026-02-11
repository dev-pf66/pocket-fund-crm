-- Lead Data Improvements Migration
-- Adds: Lead Score, Firmographics, Decision Timeline, Relationship Strength, Tags

-- 1. Lead Score
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0 CHECK (lead_score >= 0 AND lead_score <= 100);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS score_last_calculated TIMESTAMP WITH TIME ZONE;

-- 3. Firmographics
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS aum VARCHAR(100); -- e.g. "$50M-$100M"
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS investment_thesis TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS portfolio_size INTEGER;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS fund_vintage VARCHAR(50); -- e.g. "2022"
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS recent_deals TEXT;

-- 4. Decision Timeline
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS expected_close_date DATE;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS budget_discussed VARCHAR(100);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS key_blockers TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS decision_process_stage VARCHAR(100); -- e.g. "Evaluation", "Approval", "Legal Review"

-- 5. Relationship Strength
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS relationship_strength VARCHAR(50) DEFAULT 'cold'; -- 'cold', 'warm', 'strong'
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS mutual_connections TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS referral_details TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS trust_level VARCHAR(50); -- 'building', 'established', 'trusted_advisor'

-- 6. LinkedIn Auto-Enrichment (fields to populate)
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS current_role VARCHAR(200);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS past_experience TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS education TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS linkedin_headline VARCHAR(300);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS enrichment_status VARCHAR(50); -- 'pending', 'enriched', 'failed'
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMP WITH TIME ZONE;

-- 10. Tags System
CREATE TABLE IF NOT EXISTS crm_tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  color VARCHAR(20) DEFAULT '#3b82f6',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm_lead_tags (
  lead_id INTEGER REFERENCES crm_leads(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES crm_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (lead_id, tag_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_crm_leads_score ON crm_leads(lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_crm_leads_expected_close ON crm_leads(expected_close_date);
CREATE INDEX IF NOT EXISTS idx_crm_leads_relationship ON crm_leads(relationship_strength);
CREATE INDEX IF NOT EXISTS idx_crm_lead_tags_lead ON crm_lead_tags(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_lead_tags_tag ON crm_lead_tags(tag_id);

-- RLS for tags
ALTER TABLE crm_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_lead_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on crm_tags"
ON crm_tags FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on crm_lead_tags"
ON crm_lead_tags FOR ALL USING (true) WITH CHECK (true);

-- Insert default tags
INSERT INTO crm_tags (name, color) VALUES
  ('Met at Conference', '#10b981'),
  ('Warm Intro', '#f59e0b'),
  ('High Priority', '#ef4444'),
  ('Q1 Target', '#8b5cf6'),
  ('Decision Maker', '#06b6d4'),
  ('Budget Approved', '#84cc16'),
  ('Technical Evaluation', '#6366f1'),
  ('Active Negotiation', '#ec4899')
ON CONFLICT (name) DO NOTHING;

-- Function to calculate lead score
CREATE OR REPLACE FUNCTION calculate_lead_score(p_lead_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_score INTEGER := 0;
  v_stage VARCHAR(50);
  v_activities_count INTEGER;
  v_days_since_last_activity INTEGER;
  v_field_completeness INTEGER;
BEGIN
  -- Get lead details
  SELECT stage INTO v_stage FROM crm_leads WHERE id = p_lead_id;

  -- Stage score (0-40 points)
  CASE v_stage
    WHEN 'client' THEN v_score := v_score + 40;
    WHEN 'active_conversation' THEN v_score := v_score + 30;
    WHEN 'warm_lead' THEN v_score := v_score + 20;
    WHEN 'cold_outreach' THEN v_score := v_score + 10;
    ELSE v_score := v_score + 5;
  END CASE;

  -- Activity count score (0-25 points)
  SELECT COUNT(*) INTO v_activities_count
  FROM crm_lead_activities
  WHERE lead_id = p_lead_id;

  IF v_activities_count >= 10 THEN v_score := v_score + 25;
  ELSIF v_activities_count >= 5 THEN v_score := v_score + 15;
  ELSIF v_activities_count >= 2 THEN v_score := v_score + 10;
  ELSIF v_activities_count >= 1 THEN v_score := v_score + 5;
  END IF;

  -- Recency score (0-20 points)
  SELECT EXTRACT(DAY FROM NOW() - MAX(activity_date))::INTEGER INTO v_days_since_last_activity
  FROM crm_lead_activities
  WHERE lead_id = p_lead_id;

  IF v_days_since_last_activity IS NULL THEN
    v_score := v_score + 0; -- No activities yet
  ELSIF v_days_since_last_activity <= 7 THEN
    v_score := v_score + 20;
  ELSIF v_days_since_last_activity <= 14 THEN
    v_score := v_score + 15;
  ELSIF v_days_since_last_activity <= 30 THEN
    v_score := v_score + 10;
  ELSIF v_days_since_last_activity <= 60 THEN
    v_score := v_score + 5;
  END IF;

  -- Field completeness score (0-15 points)
  SELECT (
    CASE WHEN email IS NOT NULL AND email != '' THEN 2 ELSE 0 END +
    CASE WHEN phone IS NOT NULL AND phone != '' THEN 2 ELSE 0 END +
    CASE WHEN linkedin_url IS NOT NULL AND linkedin_url != '' THEN 2 ELSE 0 END +
    CASE WHEN deal_criteria IS NOT NULL AND deal_criteria != '' THEN 3 ELSE 0 END +
    CASE WHEN aum IS NOT NULL AND aum != '' THEN 2 ELSE 0 END +
    CASE WHEN investment_thesis IS NOT NULL AND investment_thesis != '' THEN 2 ELSE 0 END +
    CASE WHEN expected_close_date IS NOT NULL THEN 2 ELSE 0 END
  ) INTO v_field_completeness
  FROM crm_leads WHERE id = p_lead_id;

  v_score := v_score + v_field_completeness;

  -- Cap at 100
  IF v_score > 100 THEN v_score := 100; END IF;

  -- Update the lead
  UPDATE crm_leads
  SET lead_score = v_score, score_last_calculated = NOW()
  WHERE id = p_lead_id;

  RETURN v_score;
END;
$$ LANGUAGE plpgsql;

-- Trigger to recalculate score when activities are added
CREATE OR REPLACE FUNCTION recalculate_lead_score_trigger()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM calculate_lead_score(NEW.lead_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_recalculate_score_on_activity ON crm_lead_activities;
CREATE TRIGGER trigger_recalculate_score_on_activity
  AFTER INSERT OR UPDATE ON crm_lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION recalculate_lead_score_trigger();
