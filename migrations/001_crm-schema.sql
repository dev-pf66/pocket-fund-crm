-- ============================================================================
-- SALES CRM FOR POCKET FUND
-- ============================================================================

-- Leads table
CREATE TABLE IF NOT EXISTS crm_leads (
  id SERIAL PRIMARY KEY,

  -- Basic Info
  name VARCHAR(200) NOT NULL,
  firm_name VARCHAR(200),
  email VARCHAR(255),
  phone VARCHAR(50),
  linkedin_url TEXT,

  -- Classification
  lead_type VARCHAR(50), -- 'Independent Sponsor', 'PE Firm', 'Family Office', 'Other'
  deal_criteria TEXT, -- 'B2B SaaS, $1-5M revenue'

  -- Pipeline Stage
  stage VARCHAR(50) DEFAULT 'cold_outreach',
  -- Options: cold_outreach, warm_lead, active_conversation, client, reach_out_later, passed

  -- Activity Tracking
  last_activity_date TIMESTAMP WITH TIME ZONE,
  last_activity_type VARCHAR(50), -- 'email', 'call', 'linkedin', 'meeting'

  -- Follow-up Management
  next_follow_up_date DATE,
  reach_out_later_date DATE,

  -- Flags
  needs_sample_deals BOOLEAN DEFAULT false,

  -- Notes
  notes TEXT,
  initial_conversation TEXT,

  -- Metadata
  created_by INTEGER REFERENCES people(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Source tracking
  lead_source VARCHAR(100) -- 'LinkedIn', 'Referral', 'Cold Email', 'Event', 'Website'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(stage);
CREATE INDEX IF NOT EXISTS idx_crm_leads_created_by ON crm_leads(created_by);
CREATE INDEX IF NOT EXISTS idx_crm_leads_last_activity ON crm_leads(last_activity_date);
CREATE INDEX IF NOT EXISTS idx_crm_leads_follow_up ON crm_leads(next_follow_up_date);

-- Lead activities table
CREATE TABLE IF NOT EXISTS crm_lead_activities (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,

  -- Activity Details
  activity_type VARCHAR(50) NOT NULL, -- 'call', 'email', 'linkedin_message', 'meeting', 'sample_sent', 'proposal_sent', 'note'
  activity_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT,

  -- For sample deals sent
  sample_deals_sent INTEGER[], -- Array of sample_deal IDs

  -- Who logged it
  logged_by INTEGER REFERENCES people(id),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_activities_lead ON crm_lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_lead_activities_date ON crm_lead_activities(activity_date);
CREATE INDEX IF NOT EXISTS idx_crm_lead_activities_type ON crm_lead_activities(activity_type);

-- Sample deals library
CREATE TABLE IF NOT EXISTS crm_sample_deals (
  id SERIAL PRIMARY KEY,

  -- Basic Info
  title VARCHAR(200) NOT NULL, -- 'Q4 2024 - SaaS Acquisition for Independent Sponsor'
  description TEXT,

  -- Classification
  client_type VARCHAR(100), -- 'Independent Sponsor', 'PE Firm', etc.
  deal_size_range VARCHAR(50), -- '$1-5M', '$5-10M'
  industry VARCHAR(100), -- 'B2B SaaS', 'E-commerce', 'Marketplace'

  -- Details
  what_we_did TEXT,
  outcome TEXT,
  client_testimonial TEXT,
  timeline VARCHAR(100),
  metrics TEXT, -- 'Sourced 15 targets, closed in 6 weeks'

  -- File attachment
  file_url TEXT,
  file_type VARCHAR(50), -- 'pdf', 'pptx', 'docx'

  -- Metadata
  created_by INTEGER REFERENCES people(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_crm_sample_deals_active ON crm_sample_deals(is_active);
CREATE INDEX IF NOT EXISTS idx_crm_sample_deals_industry ON crm_sample_deals(industry);

-- CRM Settings
CREATE TABLE IF NOT EXISTS crm_settings (
  id SERIAL PRIMARY KEY,

  -- Staleness thresholds (days)
  cold_outreach_threshold INTEGER DEFAULT 5,
  warm_lead_threshold INTEGER DEFAULT 7,
  active_conversation_threshold INTEGER DEFAULT 3,

  -- Weekly targets
  weekly_discovery_call_target INTEGER DEFAULT 7,

  -- Notification preferences
  email_alerts BOOLEAN DEFAULT true,
  slack_alerts BOOLEAN DEFAULT false,

  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default settings
INSERT INTO crm_settings (id, cold_outreach_threshold, warm_lead_threshold, active_conversation_threshold, weekly_discovery_call_target)
VALUES (1, 5, 7, 3, 7)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sample_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow all for now, can be restricted later)
CREATE POLICY "Allow all operations on crm_leads" ON crm_leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on crm_lead_activities" ON crm_lead_activities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on crm_sample_deals" ON crm_sample_deals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on crm_settings" ON crm_settings FOR ALL USING (true) WITH CHECK (true);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_crm_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crm_leads_updated_at
  BEFORE UPDATE ON crm_leads
  FOR EACH ROW
  EXECUTE FUNCTION update_crm_updated_at();

CREATE TRIGGER crm_sample_deals_updated_at
  BEFORE UPDATE ON crm_sample_deals
  FOR EACH ROW
  EXECUTE FUNCTION update_crm_updated_at();

-- Function to get CRM heartbeat (for Sage monitoring)
CREATE OR REPLACE FUNCTION get_crm_heartbeat()
RETURNS JSON AS $$
DECLARE
  result JSON;
  stale_count INTEGER;
  followup_count INTEGER;
  samples_needed_count INTEGER;
  active_stale_count INTEGER;
  settings_rec RECORD;
BEGIN
  -- Get settings
  SELECT * INTO settings_rec FROM crm_settings WHERE id = 1;

  -- Count stale leads
  SELECT COUNT(*) INTO stale_count
  FROM crm_leads
  WHERE stage IN ('cold_outreach', 'warm_lead', 'active_conversation')
    AND last_activity_date IS NOT NULL
    AND (
      (stage = 'cold_outreach' AND NOW() - last_activity_date > (settings_rec.cold_outreach_threshold || ' days')::INTERVAL) OR
      (stage = 'warm_lead' AND NOW() - last_activity_date > (settings_rec.warm_lead_threshold || ' days')::INTERVAL) OR
      (stage = 'active_conversation' AND NOW() - last_activity_date > (settings_rec.active_conversation_threshold || ' days')::INTERVAL)
    );

  -- Count follow-ups due today
  SELECT COUNT(*) INTO followup_count
  FROM crm_leads
  WHERE (next_follow_up_date = CURRENT_DATE OR reach_out_later_date = CURRENT_DATE)
    AND stage != 'passed';

  -- Count leads needing samples
  SELECT COUNT(*) INTO samples_needed_count
  FROM crm_leads
  WHERE needs_sample_deals = true
    AND stage != 'passed';

  -- Count active conversations gone stale (CRITICAL)
  SELECT COUNT(*) INTO active_stale_count
  FROM crm_leads
  WHERE stage = 'active_conversation'
    AND last_activity_date IS NOT NULL
    AND NOW() - last_activity_date > (settings_rec.active_conversation_threshold || ' days')::INTERVAL;

  -- Build result
  result := json_build_object(
    'status', CASE WHEN (stale_count + followup_count + samples_needed_count + active_stale_count) = 0 THEN 'healthy' ELSE 'needs_attention' END,
    'timestamp', NOW(),
    'stale_leads', stale_count,
    'followups_due', followup_count,
    'samples_needed', samples_needed_count,
    'active_gone_cold', active_stale_count
  );

  RETURN result;
END;
$$ LANGUAGE plpgsql;
