-- ============================================================================
-- MERGE PIPELINE STAGES (Sept 2026, Dev's call)
-- ============================================================================
-- Restructures crm_leads.stage:
--   new_lead + cold_outreach       -> outreach
--   warm_lead + active_conversation -> warm_active
--   meeting_booked moves earlier in the funnel and changes meaning: it now
--     means "agreed to meet", not "met". A lead already sitting at
--     meeting_booked already had its meeting counted under the old
--     semantics, so it moves straight to warm_active rather than staying in
--     a stage whose meaning just changed under it.
--
-- New order: outreach -> responded -> meeting_booked -> warm_active -> client
-- (passed stays terminal/outside, reach_out_later stays parked/outside).
--
-- Run via the /migrate skill. Idempotent — safe to re-run.

-- Data remap. Order matters: meeting_booked must fold into warm_active
-- alongside warm_lead/active_conversation, not linger as its new (different)
-- meaning.
UPDATE crm_leads SET stage = 'outreach' WHERE stage IN ('new_lead', 'cold_outreach');
UPDATE crm_leads SET stage = 'warm_active' WHERE stage IN ('warm_lead', 'active_conversation', 'meeting_booked');

ALTER TABLE crm_leads ALTER COLUMN stage SET DEFAULT 'outreach';

-- calculate_lead_score (migration 003) — live RPC, called from
-- src/lib/api/misc.js. Stage score buckets updated to the new stage set.
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
    WHEN 'warm_active' THEN v_score := v_score + 30;
    WHEN 'meeting_booked' THEN v_score := v_score + 25;
    WHEN 'outreach' THEN v_score := v_score + 10;
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

-- get_crm_heartbeat (migration 001). Not currently called from the app
-- (superseded by the JS equivalents in src/lib/api/leads.js), but kept
-- consistent with the new stage set rather than left silently wrong.
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
  WHERE stage IN ('outreach', 'meeting_booked', 'warm_active')
    AND last_activity_date IS NOT NULL
    AND (
      (stage = 'outreach' AND NOW() - last_activity_date > (settings_rec.cold_outreach_threshold || ' days')::INTERVAL) OR
      (stage = 'meeting_booked' AND NOW() - last_activity_date > (settings_rec.active_conversation_threshold || ' days')::INTERVAL) OR
      (stage = 'warm_active' AND NOW() - last_activity_date > (settings_rec.active_conversation_threshold || ' days')::INTERVAL)
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

  -- Count warm/active leads gone stale (CRITICAL)
  SELECT COUNT(*) INTO active_stale_count
  FROM crm_leads
  WHERE stage = 'warm_active'
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

-- Verification:
-- SELECT stage, COUNT(*) FROM crm_leads GROUP BY stage ORDER BY stage;
--   (should show only outreach / responded / meeting_booked / warm_active /
--    client / reach_out_later / passed — no new_lead, cold_outreach, warm_lead,
--    active_conversation rows left)
