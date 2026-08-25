-- ============================================
-- STAGE EVENTS MUST MATCH REALITY
-- ============================================
-- Closes the hole 042 left open and admitted to.
--
-- 041 relaxed INSERT to any signed-in user, because checking lead ownership
-- inside the policy evaluates AFTER the update that triggered the event and
-- so denied the analyst-to-closer hand-off. 042 re-tightened the ACTOR axis
-- (you may only credit yourself) but left `lead_id` unscoped: a signed-in
-- user could append events crediting themselves for arbitrary leads and top
-- the team strip, which now ranks people by exactly this.
--
-- The fix is to constrain the CLAIM rather than the actor's relationship to
-- the lead: an event may only assert a transition the lead has actually made.
-- `to_stage` must equal the lead's current stage. You cannot invent a move
-- that didn't happen, whoever you are and whoever owns the lead.
--
-- lead_current_stage() is SECURITY DEFINER on purpose. A plain subquery
-- against crm_leads inside the policy would itself be RLS-filtered, so a lead
-- just reassigned away would read as NULL and deny the very hand-off 041 was
-- fixing. It exposes one stage string for a lead id — strictly less than the
-- SELECT policy already allows.
--
-- Residual, accepted: someone could still claim credit for a move another
-- person made, in the window while the lead sits at that stage. That's a
-- narrow, detectable, internal-only case — versus fabricating arbitrary
-- movement, which is now impossible.
--
-- Run via the /migrate skill. Idempotent.

CREATE OR REPLACE FUNCTION lead_current_stage(p_lead_id INTEGER)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT stage FROM crm_leads WHERE id = p_lead_id;
$$;

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
    -- The lead must actually be where this event claims it landed.
    AND to_stage IS NOT DISTINCT FROM lead_current_stage(lead_id)
  );

-- Verification:
-- SELECT policyname, cmd, with_check FROM pg_policies
--   WHERE tablename='crm_lead_stage_events' AND cmd='INSERT';
