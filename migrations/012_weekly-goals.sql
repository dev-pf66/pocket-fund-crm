-- Weekly Goals System for Pocket Fund CRM
-- Run this in Supabase SQL Editor

-- Table: Weekly Goal Templates (defaults per person/role)
CREATE TABLE IF NOT EXISTS crm_weekly_goal_templates (
  id SERIAL PRIMARY KEY,
  person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
  role VARCHAR(50), -- 'ceo', 'analyst', 'intern' - fallback if no person_id
  goal_text TEXT NOT NULL,
  goal_order INTEGER DEFAULT 0, -- display order
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: Weekly Goals (actual goals for person + week)
CREATE TABLE IF NOT EXISTS crm_weekly_goals (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL, -- Monday of the week
  goal_text TEXT NOT NULL,
  goal_order INTEGER DEFAULT 0,
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMP WITH TIME ZONE,
  notes TEXT, -- personal notes on the goal
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(person_id, week_start_date, goal_text) -- prevent duplicates
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_goal_templates_person ON crm_weekly_goal_templates(person_id);
CREATE INDEX IF NOT EXISTS idx_goal_templates_role ON crm_weekly_goal_templates(role);
CREATE INDEX IF NOT EXISTS idx_weekly_goals_person_week ON crm_weekly_goals(person_id, week_start_date);
CREATE INDEX IF NOT EXISTS idx_weekly_goals_completed ON crm_weekly_goals(is_completed);

-- RLS Policies
ALTER TABLE crm_weekly_goal_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_weekly_goals ENABLE ROW LEVEL SECURITY;

-- Templates: Anyone can view, only authenticated users can manage
CREATE POLICY "Anyone can view goal templates"
ON crm_weekly_goal_templates FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can manage goal templates"
ON crm_weekly_goal_templates FOR ALL
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- Weekly Goals: Users can only see/manage their own goals
CREATE POLICY "Users can view their own weekly goals"
ON crm_weekly_goals FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can manage their own weekly goals"
ON crm_weekly_goals FOR ALL
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_weekly_goals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crm_weekly_goal_templates_updated_at
  BEFORE UPDATE ON crm_weekly_goal_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_weekly_goals_updated_at();

CREATE TRIGGER crm_weekly_goals_updated_at
  BEFORE UPDATE ON crm_weekly_goals
  FOR EACH ROW
  EXECUTE FUNCTION update_weekly_goals_updated_at();

-- Helper function: Get Monday of current week
CREATE OR REPLACE FUNCTION get_week_start(input_date DATE DEFAULT CURRENT_DATE)
RETURNS DATE AS $$
BEGIN
  RETURN input_date - ((EXTRACT(DOW FROM input_date)::INTEGER + 6) % 7);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Comment
COMMENT ON TABLE crm_weekly_goal_templates IS 'Template goals that can be assigned to people or roles';
COMMENT ON TABLE crm_weekly_goals IS 'Actual weekly goals for each person';
