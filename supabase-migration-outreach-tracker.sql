-- Outreach Tracker Migration
-- Tracks daily outreach activities (goal: 10 per day)

CREATE TABLE IF NOT EXISTS crm_outreach_log (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL, -- Optional link to lead

  -- Outreach details
  lead_name VARCHAR(200), -- Free-form if not linked to CRM lead yet
  firm_name VARCHAR(200),
  outreach_type VARCHAR(50) NOT NULL, -- 'cold_email', 'linkedin_message', 'phone_call', 'other'
  outreach_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Status tracking
  status VARCHAR(50) DEFAULT 'sent', -- 'sent', 'replied', 'no_response', 'bounced'
  notes TEXT,

  -- Metadata
  logged_by INTEGER REFERENCES people(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_outreach_date ON crm_outreach_log(outreach_date DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_logged_by ON crm_outreach_log(logged_by);
CREATE INDEX IF NOT EXISTS idx_outreach_lead ON crm_outreach_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_type ON crm_outreach_log(outreach_type);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON crm_outreach_log(status);

-- RLS
ALTER TABLE crm_outreach_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on crm_outreach_log"
ON crm_outreach_log FOR ALL USING (true) WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER crm_outreach_log_updated_at
  BEFORE UPDATE ON crm_outreach_log
  FOR EACH ROW
  EXECUTE FUNCTION update_crm_updated_at();

-- Function to get daily outreach stats
CREATE OR REPLACE FUNCTION get_daily_outreach_stats(days_back INTEGER DEFAULT 30)
RETURNS TABLE(
  outreach_date DATE,
  total_outreaches BIGINT,
  cold_emails BIGINT,
  linkedin_messages BIGINT,
  phone_calls BIGINT,
  other_outreaches BIGINT,
  replied_count BIGINT,
  goal_met BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.outreach_date,
    COUNT(*)::BIGINT as total_outreaches,
    COUNT(*) FILTER (WHERE o.outreach_type = 'cold_email')::BIGINT as cold_emails,
    COUNT(*) FILTER (WHERE o.outreach_type = 'linkedin_message')::BIGINT as linkedin_messages,
    COUNT(*) FILTER (WHERE o.outreach_type = 'phone_call')::BIGINT as phone_calls,
    COUNT(*) FILTER (WHERE o.outreach_type = 'other')::BIGINT as other_outreaches,
    COUNT(*) FILTER (WHERE o.status = 'replied')::BIGINT as replied_count,
    (COUNT(*) >= 10) as goal_met
  FROM crm_outreach_log o
  WHERE o.outreach_date >= CURRENT_DATE - days_back
  GROUP BY o.outreach_date
  ORDER BY o.outreach_date DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to get today's outreach count
CREATE OR REPLACE FUNCTION get_todays_outreach_count()
RETURNS INTEGER AS $$
DECLARE
  outreach_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO outreach_count
  FROM crm_outreach_log
  WHERE outreach_date = CURRENT_DATE;

  RETURN COALESCE(outreach_count, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to get weekly streak
CREATE OR REPLACE FUNCTION get_outreach_streak()
RETURNS INTEGER AS $$
DECLARE
  streak INTEGER := 0;
  check_date DATE := CURRENT_DATE;
  day_count INTEGER;
BEGIN
  LOOP
    SELECT COUNT(*)::INTEGER INTO day_count
    FROM crm_outreach_log
    WHERE outreach_date = check_date;

    -- If day met goal (10+), continue streak
    IF day_count >= 10 THEN
      streak := streak + 1;
      check_date := check_date - 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;

  RETURN streak;
END;
$$ LANGUAGE plpgsql;
