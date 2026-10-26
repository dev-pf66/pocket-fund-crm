-- ============================================
-- SHARED ≠ PUBLIC: the shared books need a login
-- ============================================
-- crm_partners (036) and crm_investors were both given a single allow-all
-- policy so the whole team could work one shared book. The sharing was right;
-- the audience was not. Both policies were written with no TO clause, and a
-- policy with no TO clause applies to PUBLIC — which includes the `anon` role.
--
-- The anon key is not a secret: it ships in the browser bundle and is present
-- in this public repo. So these two tables, plus `people`, were readable —
-- and under `WITH CHECK (true)`, writable — by anyone on the internet with no
-- account at all. Verified against production Sept 2026:
--
--   curl "https://<ref>.supabase.co/rest/v1/crm_partners?select=*&limit=1" \
--     -H "apikey: <anon key>"        -> 200, returns rows, no auth
--
-- This does NOT walk back Dev's decision that these are shared team books
-- (CLAUDE.md). Every authenticated teammate keeps full read/write on every
-- row, exactly as before. The only thing removed is access without a login.
--
-- `people` gets the same treatment: it must stay team-wide readable (the user
-- switcher, assignee pickers and leaderboards all need it) but it carries
-- names, emails and is_admin flags and has no business being anonymous.
--
-- Run via the /migrate skill. Idempotent.

-- ---------- crm_partners ----------
ALTER TABLE crm_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to crm_partners" ON crm_partners;
DROP POLICY IF EXISTS "team_all_access_partners"         ON crm_partners;
CREATE POLICY "team_all_access_partners" ON crm_partners
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ---------- crm_investors ----------
ALTER TABLE crm_investors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to crm_investors" ON crm_investors;
DROP POLICY IF EXISTS "team_all_access_investors"         ON crm_investors;
CREATE POLICY "team_all_access_investors" ON crm_investors
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ---------- people ----------
-- Team-wide readable, but only to signed-in users. Writes stay restricted to
-- the row's owner or an admin: App.jsx self-heals a missing row on first login
-- (insert own email only), and Admin manages everyone else.
ALTER TABLE people ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_can_view_people"   ON people;
DROP POLICY IF EXISTS "Allow all access to people" ON people;
DROP POLICY IF EXISTS "team_view_people"       ON people;
CREATE POLICY "team_view_people" ON people
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "self_or_admin_insert_people" ON people;
CREATE POLICY "self_or_admin_insert_people" ON people
  FOR INSERT
  TO authenticated
  WITH CHECK (
    current_user_is_admin()
    OR LOWER(email) = LOWER((SELECT auth.jwt() ->> 'email'))
  );

DROP POLICY IF EXISTS "self_or_admin_update_people" ON people;
CREATE POLICY "self_or_admin_update_people" ON people
  FOR UPDATE
  TO authenticated
  USING (
    current_user_is_admin()
    OR LOWER(email) = LOWER((SELECT auth.jwt() ->> 'email'))
  );

DROP POLICY IF EXISTS "admin_delete_people" ON people;
CREATE POLICY "admin_delete_people" ON people
  FOR DELETE
  TO authenticated
  USING (current_user_is_admin());

-- Verification — every row below must show roles={authenticated}, never {public}:
--   SELECT tablename, policyname, cmd, roles
--   FROM pg_policies
--   WHERE tablename IN ('crm_partners','crm_investors','people')
--   ORDER BY tablename, policyname;
