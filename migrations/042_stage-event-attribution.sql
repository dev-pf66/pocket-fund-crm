-- ============================================
-- STAGE EVENT ATTRIBUTION — see your own work, don't credit someone else's
-- ============================================
-- Two follow-ups to 040/041, both about `changed_by`.
--
-- 1. SELECT was scoped purely by CURRENT lead ownership, while the metrics
--    filter on changed_by. So Pushkar advances four leads on Tuesday, they're
--    reassigned to Aum on Thursday, and Pushkar's "moved forward" card drops
--    from 4 to 0 for a week that already happened. Work you did shouldn't
--    disappear because the lead moved on. You can now always read events you
--    caused, in addition to events on leads you hold.
--
-- 2. 041 relaxed INSERT to any signed-in user, to fix audit rows being denied
--    when a stage change and a reassignment were saved together. That left
--    `changed_by` entirely unconstrained — anyone could append an event
--    crediting anyone. That matters now the team strip ranks people by it
--    (same class as the events/fire spoofing fixed in e90238b).
--
--    This re-tightens on the actor axis only: you may credit yourself, or no
--    one (null = machine/API), or anything if you're an admin. It deliberately
--    does NOT re-introduce a check on the lead, which is what broke the
--    hand-off case.
--
-- Run via the /migrate skill. Idempotent.

DROP POLICY IF EXISTS "users_view_own_lead_stage_events" ON crm_lead_stage_events;
CREATE POLICY "users_view_own_lead_stage_events" ON crm_lead_stage_events
  FOR SELECT
  USING (
    current_user_is_admin()
    OR changed_by = current_person_id()
    OR EXISTS (
      SELECT 1 FROM crm_leads l
      WHERE l.id = crm_lead_stage_events.lead_id
        AND (l.created_by = current_person_id() OR l.assigned_to = current_person_id())
    )
  );

DROP POLICY IF EXISTS "users_create_lead_stage_events" ON crm_lead_stage_events;
CREATE POLICY "users_create_lead_stage_events" ON crm_lead_stage_events
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      changed_by IS NULL
      OR changed_by = current_person_id()
      OR current_user_is_admin()
    )
  );

-- Verification:
-- SELECT policyname, cmd, qual, with_check FROM pg_policies
--   WHERE tablename = 'crm_lead_stage_events';
