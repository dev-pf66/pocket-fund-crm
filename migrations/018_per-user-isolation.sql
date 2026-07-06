-- ============================================
-- PER-USER DATA ISOLATION (RLS)
-- ============================================
-- Locks down leads, outreach, and lead activities at the database layer
-- so each user only sees/modifies their own records. The app-layer filters
-- shipped in commit 9c16fd2 do this already; this migration enforces it at
-- the DB so anyone with direct API access can't bypass the filters.
--
-- Safe to run multiple times (idempotent drop-then-create).
-- Run in Supabase SQL Editor.
--
-- What stays team-wide:
--   - people (needed for user switcher, assignments)
--   - crm_settings, crm_help_articles, crm_email_templates, crm_sample_deals
--     (these are shared team resources, not per-user work)
--
-- Admin bypass: anyone with people.is_admin = true can see/edit all rows
-- (mirrors the existing admin-rls migration pattern).

-- ---------------------------------------------------------------------------
-- 1. Helper functions
-- ---------------------------------------------------------------------------

-- Returns the people.id for the currently authenticated user by matching the
-- JWT's email claim against people.email. STABLE so Postgres can cache it
-- within a single query. LANGUAGE sql keeps it inlinable.
CREATE OR REPLACE FUNCTION current_person_id()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM people
  WHERE LOWER(email) = LOWER((SELECT auth.jwt() ->> 'email'))
  LIMIT 1;
$$;

-- Returns true if the current user has is_admin = true on their people row.
CREATE OR REPLACE FUNCTION current_user_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin
     FROM people
     WHERE LOWER(email) = LOWER((SELECT auth.jwt() ->> 'email'))
     LIMIT 1),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. crm_leads — scoped to created_by OR assigned_to
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "team_can_view_leads" ON crm_leads;
DROP POLICY IF EXISTS "team_can_create_leads" ON crm_leads;
DROP POLICY IF EXISTS "team_can_update_leads" ON crm_leads;
DROP POLICY IF EXISTS "team_can_delete_leads" ON crm_leads;

DROP POLICY IF EXISTS "users_view_own_leads" ON crm_leads;
CREATE POLICY "users_view_own_leads" ON crm_leads
  FOR SELECT
  USING (
    current_user_is_admin()
    OR created_by = current_person_id()
    OR assigned_to = current_person_id()
  );

DROP POLICY IF EXISTS "users_create_leads" ON crm_leads;
CREATE POLICY "users_create_leads" ON crm_leads
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      current_user_is_admin()
      OR created_by = current_person_id()
      OR created_by IS NULL
    )
  );

DROP POLICY IF EXISTS "users_update_own_leads" ON crm_leads;
CREATE POLICY "users_update_own_leads" ON crm_leads
  FOR UPDATE
  USING (
    current_user_is_admin()
    OR created_by = current_person_id()
    OR assigned_to = current_person_id()
  );

DROP POLICY IF EXISTS "users_delete_own_leads" ON crm_leads;
CREATE POLICY "users_delete_own_leads" ON crm_leads
  FOR DELETE
  USING (
    current_user_is_admin()
    OR created_by = current_person_id()
  );

-- ---------------------------------------------------------------------------
-- 3. crm_outreach_log — scoped to logged_by
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "team_can_view_outreach" ON crm_outreach_log;
DROP POLICY IF EXISTS "team_can_create_outreach" ON crm_outreach_log;
DROP POLICY IF EXISTS "team_can_update_outreach" ON crm_outreach_log;
DROP POLICY IF EXISTS "team_can_delete_outreach" ON crm_outreach_log;

DROP POLICY IF EXISTS "users_view_own_outreach" ON crm_outreach_log;
CREATE POLICY "users_view_own_outreach" ON crm_outreach_log
  FOR SELECT
  USING (
    current_user_is_admin()
    OR logged_by = current_person_id()
  );

DROP POLICY IF EXISTS "users_create_outreach" ON crm_outreach_log;
CREATE POLICY "users_create_outreach" ON crm_outreach_log
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      current_user_is_admin()
      OR logged_by = current_person_id()
      OR logged_by IS NULL
    )
  );

DROP POLICY IF EXISTS "users_update_own_outreach" ON crm_outreach_log;
CREATE POLICY "users_update_own_outreach" ON crm_outreach_log
  FOR UPDATE
  USING (
    current_user_is_admin()
    OR logged_by = current_person_id()
  );

DROP POLICY IF EXISTS "users_delete_own_outreach" ON crm_outreach_log;
CREATE POLICY "users_delete_own_outreach" ON crm_outreach_log
  FOR DELETE
  USING (
    current_user_is_admin()
    OR logged_by = current_person_id()
  );

-- ---------------------------------------------------------------------------
-- 4. crm_lead_activities — scoped via owning lead
-- ---------------------------------------------------------------------------
-- Activities live on leads; a user can see an activity iff they can see the
-- parent lead. That keeps ownership rules in one place and avoids the awkward
-- case of an orphan activity with no logged_by.

DROP POLICY IF EXISTS "team_can_view_activities" ON crm_lead_activities;
DROP POLICY IF EXISTS "team_can_create_activities" ON crm_lead_activities;
DROP POLICY IF EXISTS "team_can_update_activities" ON crm_lead_activities;
DROP POLICY IF EXISTS "team_can_delete_activities" ON crm_lead_activities;

DROP POLICY IF EXISTS "users_view_own_lead_activities" ON crm_lead_activities;
CREATE POLICY "users_view_own_lead_activities" ON crm_lead_activities
  FOR SELECT
  USING (
    current_user_is_admin()
    OR EXISTS (
      SELECT 1 FROM crm_leads l
      WHERE l.id = crm_lead_activities.lead_id
        AND (l.created_by = current_person_id() OR l.assigned_to = current_person_id())
    )
  );

DROP POLICY IF EXISTS "users_create_lead_activities" ON crm_lead_activities;
CREATE POLICY "users_create_lead_activities" ON crm_lead_activities
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      current_user_is_admin()
      OR EXISTS (
        SELECT 1 FROM crm_leads l
        WHERE l.id = crm_lead_activities.lead_id
          AND (l.created_by = current_person_id() OR l.assigned_to = current_person_id())
      )
    )
  );

DROP POLICY IF EXISTS "users_update_own_lead_activities" ON crm_lead_activities;
CREATE POLICY "users_update_own_lead_activities" ON crm_lead_activities
  FOR UPDATE
  USING (
    current_user_is_admin()
    OR EXISTS (
      SELECT 1 FROM crm_leads l
      WHERE l.id = crm_lead_activities.lead_id
        AND (l.created_by = current_person_id() OR l.assigned_to = current_person_id())
    )
  );

DROP POLICY IF EXISTS "users_delete_own_lead_activities" ON crm_lead_activities;
CREATE POLICY "users_delete_own_lead_activities" ON crm_lead_activities
  FOR DELETE
  USING (
    current_user_is_admin()
    OR EXISTS (
      SELECT 1 FROM crm_leads l
      WHERE l.id = crm_lead_activities.lead_id
        AND (l.created_by = current_person_id() OR l.assigned_to = current_person_id())
    )
  );

-- ---------------------------------------------------------------------------
-- 5. VERIFICATION
-- ---------------------------------------------------------------------------
-- Run these to verify the migration landed correctly:
--
-- SELECT current_person_id(), current_user_is_admin();   -- run while logged in
--
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('crm_leads', 'crm_outreach_log', 'crm_lead_activities')
-- ORDER BY tablename, policyname;

-- ---------------------------------------------------------------------------
-- ROLLBACK (if needed)
-- ---------------------------------------------------------------------------
-- DROP POLICY IF EXISTS "users_view_own_leads" ON crm_leads;
-- DROP POLICY IF EXISTS "users_create_leads" ON crm_leads;
-- DROP POLICY IF EXISTS "users_update_own_leads" ON crm_leads;
-- DROP POLICY IF EXISTS "users_delete_own_leads" ON crm_leads;
-- DROP POLICY IF EXISTS "users_view_own_outreach" ON crm_outreach_log;
-- DROP POLICY IF EXISTS "users_create_outreach" ON crm_outreach_log;
-- DROP POLICY IF EXISTS "users_update_own_outreach" ON crm_outreach_log;
-- DROP POLICY IF EXISTS "users_delete_own_outreach" ON crm_outreach_log;
-- DROP POLICY IF EXISTS "users_view_own_lead_activities" ON crm_lead_activities;
-- DROP POLICY IF EXISTS "users_create_lead_activities" ON crm_lead_activities;
-- DROP POLICY IF EXISTS "users_update_own_lead_activities" ON crm_lead_activities;
-- DROP POLICY IF EXISTS "users_delete_own_lead_activities" ON crm_lead_activities;
--
-- -- Then re-create the permissive team policies from supabase-security-rls-policies.sql
-- -- DROP FUNCTION current_person_id(); DROP FUNCTION current_user_is_admin();
