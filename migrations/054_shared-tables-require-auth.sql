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

-- ---------- clear the slate first ----------
-- Dropping by name cannot close this hole, and that matters more than it looks.
--
-- Permissive RLS policies are OR-ed: ONE surviving policy that applies to PUBLIC
-- re-opens the table no matter how correct the new policy is. And the names are
-- not knowable from this repo — grepping every migration finds five policies on
-- `people` that the original DROP list here missed
-- (authenticated_users_can_view_people, allow_person_creation,
-- users_can_update_own_record, admins_can_update_people,
-- admins_can_delete_people), and NONE of them can explain the anon read that is
-- still live in production, which means at least one more policy was created
-- outside this ledger — almost certainly in the Supabase dashboard, the same way
-- crm_leads got its archive columns.
--
-- So: drop EVERY policy on these three tables, then create exactly the intended
-- set below. The end state is then determined by this file alone rather than by
-- what happens to exist in production, which is the only version of this that
-- can actually be verified.
--
-- Safe: this runs in one transaction, and with RLS enabled and no policy present
-- the tables deny everything rather than allowing it. Nothing is lost that this
-- file does not immediately recreate.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('crm_partners', 'crm_investors', 'people')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   pol.policyname, pol.schemaname, pol.tablename);
    RAISE NOTICE 'dropped policy % on %', pol.policyname, pol.tablename;
  END LOOP;
END $$;

-- ---------- crm_partners ----------
ALTER TABLE crm_partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_all_access_partners" ON crm_partners
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ---------- crm_investors ----------
ALTER TABLE crm_investors ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY "team_view_people" ON people
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "self_or_admin_insert_people" ON people
  FOR INSERT
  TO authenticated
  WITH CHECK (
    current_user_is_admin()
    OR LOWER(email) = LOWER((SELECT auth.jwt() ->> 'email'))
  );

CREATE POLICY "self_or_admin_update_people" ON people
  FOR UPDATE
  TO authenticated
  USING (
    current_user_is_admin()
    OR LOWER(email) = LOWER((SELECT auth.jwt() ->> 'email'))
  );

CREATE POLICY "admin_delete_people" ON people
  FOR DELETE
  TO authenticated
  USING (current_user_is_admin());

-- Verification — every row below must show roles={authenticated}, never {public}.
-- The sweep above is what makes this assertion meaningful: without it a leftover
-- PUBLIC policy would still be listed here and would still grant anon access.
--   SELECT tablename, policyname, cmd, roles
--   FROM pg_policies
--   WHERE tablename IN ('crm_partners','crm_investors','people')
--   ORDER BY tablename, policyname;
--
-- And the only check that actually settles it — from outside, with the anon key
-- that ships in the browser bundle. All three must return ZERO rows:
--   curl -s "$VITE_SUPABASE_URL/rest/v1/crm_partners?select=id&limit=1"  -H "apikey: $VITE_SUPABASE_ANON_KEY"
--   curl -s "$VITE_SUPABASE_URL/rest/v1/crm_investors?select=id&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY"
--   curl -s "$VITE_SUPABASE_URL/rest/v1/people?select=id&limit=1"        -H "apikey: $VITE_SUPABASE_ANON_KEY"
-- Before this migration all three returned rows; `people` returned all 13,
-- including name, email and is_admin.
