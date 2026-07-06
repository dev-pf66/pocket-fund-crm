-- Fix Activity Feed Triggers to Handle NULL User Names
-- Run this after the team features migration

-- Fix lead creation trigger
CREATE OR REPLACE FUNCTION trigger_log_lead_creation()
RETURNS TRIGGER AS $$
DECLARE
  creator_name VARCHAR;
BEGIN
  -- Get creator name, fallback to 'Someone' if not found
  SELECT name INTO creator_name FROM people WHERE id = NEW.created_by;
  IF creator_name IS NULL THEN
    creator_name := 'Someone';
  END IF;

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

-- Fix lead assignment trigger
CREATE OR REPLACE FUNCTION trigger_log_lead_assignment()
RETURNS TRIGGER AS $$
DECLARE
  assigned_to_name VARCHAR;
  assigned_by_name VARCHAR;
BEGIN
  IF NEW.assigned_to IS NOT NULL AND (OLD.assigned_to IS NULL OR OLD.assigned_to != NEW.assigned_to) THEN
    -- Get person names, fallback to 'Someone' if not found
    SELECT name INTO assigned_to_name FROM people WHERE id = NEW.assigned_to;
    SELECT name INTO assigned_by_name FROM people WHERE id = NEW.assigned_by;

    IF assigned_to_name IS NULL THEN
      assigned_to_name := 'Unknown';
    END IF;
    IF assigned_by_name IS NULL THEN
      assigned_by_name := 'Someone';
    END IF;

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

-- Fix stage change trigger
CREATE OR REPLACE FUNCTION trigger_log_stage_change()
RETURNS TRIGGER AS $$
DECLARE
  person_name VARCHAR;
BEGIN
  IF NEW.stage != OLD.stage THEN
    -- Try to get name from updated_by or created_by, fallback to 'Someone'
    SELECT name INTO person_name FROM people WHERE id = NEW.created_by LIMIT 1;
    IF person_name IS NULL THEN
      person_name := 'Someone';
    END IF;

    PERFORM log_activity(
      NEW.created_by,
      person_name,
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
