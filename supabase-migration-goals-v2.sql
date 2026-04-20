-- Goals System v2 for Pocket Fund CRM
-- Replaces crm_weekly_goals and crm_weekly_goal_templates with a structured
-- goal (text + target count + frequency) and per-period progress counter.
-- WARNING: This drops the old goals tables. Any existing weekly goals and
-- templates data will be lost. Run in Supabase SQL Editor.

DROP TABLE IF EXISTS crm_weekly_goals CASCADE;
DROP TABLE IF EXISTS crm_weekly_goal_templates CASCADE;

-- Table: Goals (one row per goal per person)
CREATE TABLE IF NOT EXISTS crm_goals (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  goal_text TEXT NOT NULL,
  target_count INTEGER NOT NULL DEFAULT 1 CHECK (target_count > 0),
  frequency VARCHAR(10) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  goal_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: Goal Progress (one row per goal per period)
CREATE TABLE IF NOT EXISTS crm_goal_progress (
  id SERIAL PRIMARY KEY,
  goal_id INTEGER NOT NULL REFERENCES crm_goals(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(goal_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_goals_person ON crm_goals(person_id);
CREATE INDEX IF NOT EXISTS idx_goals_active ON crm_goals(is_active);
CREATE INDEX IF NOT EXISTS idx_goal_progress_goal ON crm_goal_progress(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_progress_period ON crm_goal_progress(period_start);

ALTER TABLE crm_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_goal_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view goals"
ON crm_goals FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can manage goals"
ON crm_goals FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view goal progress"
ON crm_goal_progress FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can manage goal progress"
ON crm_goal_progress FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION update_goals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crm_goals_updated_at
  BEFORE UPDATE ON crm_goals
  FOR EACH ROW
  EXECUTE FUNCTION update_goals_updated_at();

CREATE TRIGGER crm_goal_progress_updated_at
  BEFORE UPDATE ON crm_goal_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_goals_updated_at();

COMMENT ON TABLE crm_goals IS 'Structured goals per person (text + target + frequency).';
COMMENT ON TABLE crm_goal_progress IS 'Per-period progress counter for each goal.';
