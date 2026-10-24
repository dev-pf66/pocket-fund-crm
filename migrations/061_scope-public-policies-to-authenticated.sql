-- ============================================
-- 061: no policy in the public schema applies to PUBLIC / anon
-- ============================================
-- Follow-up to 054 / 056, which closed the anon hole on crm_partners,
-- crm_investors and people only. Migrations 001-006 and 017 created "Allow all"
-- policies (USING (true) WITH CHECK (true)) with no TO clause on crm_leads,
-- crm_lead_activities, crm_outreach_log, crm_transcripts, crm_tags and others.
-- Whether those were later dropped in production cannot be told from this repo,
-- and 056 shows why DROP-by-name is not a reliable way to find out.
--
-- This does the check and the fix from inside the database, by role rather than
-- by name. Team access is unchanged (every policy keeps its USING / WITH CHECK;
-- crm_investors stays an open shared book for the logged-in team, per CLAUDE.md).
--
-- Run via the /migrate skill. Idempotent. Verify afterwards from outside with
-- the anon key: reads should return 0 rows and writes 42501.

DO $$
DECLARE
  p RECORD;
  n INT := 0;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles = '{public}'::name[]
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I TO authenticated',
                   p.policyname, p.schemaname, p.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Re-scoped % PUBLIC polic(y/ies) to authenticated', n;
END $$;

-- Assert the end state: no public-schema policy still applies to PUBLIC or anon.
DO $$
DECLARE
  bad TEXT;
  open_tables TEXT;
BEGIN
  SELECT string_agg(format('%s.%s (roles=%s)', tablename, policyname, roles::text), '; ')
  INTO bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND roles::text[] && ARRAY['public', 'anon'];
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'Anonymous access is still open via: %. Scope each TO authenticated, or drop it if it is not needed.',
      bad;
  END IF;

  -- Information only: a table with RLS off ignores policies entirely.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
  INTO open_tables
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false;
  IF open_tables IS NOT NULL THEN
    RAISE NOTICE 'RLS is OFF on: % (anon key can read these if the anon role has table grants)', open_tables;
  END IF;
END $$;
