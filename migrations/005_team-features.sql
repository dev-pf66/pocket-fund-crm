-- Team Features Migration
-- Lead Assignment System + Activity Feed

-- ============================================================================
-- LEAD ASSIGNMENT
-- ============================================================================

-- Add assignment fields to leads
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assigned_by INTEGER REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assigned_date TIMESTAMP WITH TIME ZONE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned_to ON crm_leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned_by ON crm_leads(assigned_by);

-- ============================================================================
-- ACTIVITY FEED
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm_activity_feed (
  id SERIAL PRIMARY KEY,

  -- Who did it
  user_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  user_name VARCHAR(200), -- Denormalized for performance

  -- What happened
  action_type VARCHAR(50) NOT NULL, -- 'lead_created', 'lead_assigned', 'outreach_logged', 'status_changed', 'lead_replied', 'lead_qualified'
  description TEXT NOT NULL, -- Human-readable description

  -- What entity
  entity_type VARCHAR(50), -- 'lead', 'outreach'
  entity_id INTEGER, -- ID of the lead or outreach
  entity_name VARCHAR(200), -- Lead name or firm name for quick display

  -- Metadata
  metadata JSONB, -- Additional data (old_value, new_value, etc.)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_activity_feed_created ON crm_activity_feed(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_feed_user ON crm_activity_feed(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_feed_entity ON crm_activity_feed(entity_type, entity_id);

-- RLS
ALTER TABLE crm_activity_feed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on crm_activity_feed"
ON crm_activity_feed FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to log activity
CREATE OR REPLACE FUNCTION log_activity(
  p_user_id INTEGER,
  p_user_name VARCHAR,
  p_action_type VARCHAR,
  p_description TEXT,
  p_entity_type VARCHAR DEFAULT NULL,
  p_entity_id INTEGER DEFAULT NULL,
  p_entity_name VARCHAR DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO crm_activity_feed (
    user_id,
    user_name,
    action_type,
    description,
    entity_type,
    entity_id,
    entity_name,
    metadata
  ) VALUES (
    p_user_id,
    p_user_name,
    p_action_type,
    p_description,
    p_entity_type,
    p_entity_id,
    p_entity_name,
    p_metadata
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get recent activity
CREATE OR REPLACE FUNCTION get_recent_activity(limit_count INTEGER DEFAULT 15)
RETURNS TABLE(
  id INTEGER,
  user_id INTEGER,
  user_name VARCHAR,
  action_type VARCHAR,
  description TEXT,
  entity_type VARCHAR,
  entity_id INTEGER,
  entity_name VARCHAR,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.user_id,
    a.user_name,
    a.action_type,
    a.description,
    a.entity_type,
    a.entity_id,
    a.entity_name,
    a.metadata,
    a.created_at
  FROM crm_activity_feed a
  ORDER BY a.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get activity by user
CREATE OR REPLACE FUNCTION get_user_activity(p_user_id INTEGER, limit_count INTEGER DEFAULT 15)
RETURNS TABLE(
  id INTEGER,
  user_id INTEGER,
  user_name VARCHAR,
  action_type VARCHAR,
  description TEXT,
  entity_type VARCHAR,
  entity_id INTEGER,
  entity_name VARCHAR,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.user_id,
    a.user_name,
    a.action_type,
    a.description,
    a.entity_type,
    a.entity_id,
    a.entity_name,
    a.metadata,
    a.created_at
  FROM crm_activity_feed a
  WHERE a.user_id = p_user_id
  ORDER BY a.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- AUTO-LOGGING TRIGGERS
-- ============================================================================

-- Trigger for lead assignment
CREATE OR REPLACE FUNCTION trigger_log_lead_assignment()
RETURNS TRIGGER AS $$
DECLARE
  assigned_to_name VARCHAR;
  assigned_by_name VARCHAR;
BEGIN
  IF NEW.assigned_to IS NOT NULL AND (OLD.assigned_to IS NULL OR OLD.assigned_to != NEW.assigned_to) THEN
    -- Get person names
    SELECT name INTO assigned_to_name FROM people WHERE id = NEW.assigned_to;
    SELECT name INTO assigned_by_name FROM people WHERE id = NEW.assigned_by;

    -- Log activity
    PERFORM log_activity(
      NEW.assigned_by,
      assigned_by_name,
      'lead_assigned',
      assigned_by_name || ' assigned ' || NEW.name || ' (' || COALESCE(NEW.firm_name, 'No firm') || ') to ' || assigned_to_name,
      'lead',
      NEW.id,
      NEW.name,
      jsonb_build_object('assigned_to', assigned_to_name, 'firm', NEW.firm_name)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_lead_assignment ON crm_leads;
CREATE TRIGGER trigger_lead_assignment
  AFTER UPDATE ON crm_leads
  FOR EACH ROW
  WHEN (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)
  EXECUTE FUNCTION trigger_log_lead_assignment();

-- Trigger for lead creation
CREATE OR REPLACE FUNCTION trigger_log_lead_creation()
RETURNS TRIGGER AS $$
DECLARE
  creator_name VARCHAR;
BEGIN
  SELECT name INTO creator_name FROM people WHERE id = NEW.created_by;

  PERFORM log_activity(
    NEW.created_by,
    creator_name,
    'lead_created',
    creator_name || ' added new lead: ' || NEW.name || CASE WHEN NEW.firm_name IS NOT NULL THEN ' at ' || NEW.firm_name ELSE '' END,
    'lead',
    NEW.id,
    NEW.name,
    jsonb_build_object('firm', NEW.firm_name, 'stage', NEW.stage)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_lead_creation ON crm_leads;
CREATE TRIGGER trigger_lead_creation
  AFTER INSERT ON crm_leads
  FOR EACH ROW
  EXECUTE FUNCTION trigger_log_lead_creation();

-- Trigger for stage changes
CREATE OR REPLACE FUNCTION trigger_log_stage_change()
RETURNS TRIGGER AS $$
DECLARE
  person_name VARCHAR;
BEGIN
  IF NEW.stage != OLD.stage THEN
    SELECT name INTO person_name FROM people WHERE id = NEW.created_by LIMIT 1;

    PERFORM log_activity(
      NEW.created_by,
      COALESCE(person_name, 'Someone'),
      'status_changed',
      NEW.name || ' moved from ' || REPLACE(OLD.stage, '_', ' ') || ' to ' || REPLACE(NEW.stage, '_', ' '),
      'lead',
      NEW.id,
      NEW.name,
      jsonb_build_object('old_stage', OLD.stage, 'new_stage', NEW.stage, 'firm', NEW.firm_name)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_stage_change ON crm_leads;
CREATE TRIGGER trigger_stage_change
  AFTER UPDATE ON crm_leads
  FOR EACH ROW
  WHEN (NEW.stage IS DISTINCT FROM OLD.stage)
  EXECUTE FUNCTION trigger_log_stage_change();

-- Note: Outreach logging will be done manually in the app when creating outreach
