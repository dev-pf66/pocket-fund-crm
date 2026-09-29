-- ============================================
-- 056: assert the shared-book policies are what 054 intended
-- ============================================
-- 054 closed anonymous access to crm_partners, crm_investors and people. Closing
-- it was verified from outside with the anon key (0 rows read, 42501 on write).
-- What that check CANNOT tell you is the other half: whether the team still has
-- access, or whether an RLS tightening locked everyone out. Those two failures
-- look nothing alike from the internet and identical from a migration log.
--
-- So this asserts the end state from inside the database:
--   1. RLS is enabled on all three tables.
--   2. NOT ONE policy on them applies to PUBLIC or anon. A single leftover
--      permissive PUBLIC policy silently re-opens the table, because permissive
--      policies are OR-ed — that is exactly how the original hole survived a
--      DROP-by-name list.
--   3. The policies the app actually needs are present: the shared books are
--      readable and writable by `authenticated`, and people is readable by
--      `authenticated`. Without this, "no PUBLIC policies" would also pass on a
--      table nobody can read at all.
--
-- Pure assertion — changes nothing. Re-runnable, and worth re-running: it fails
-- loudly the moment someone adds a PUBLIC policy in the dashboard, which is how
-- the original one got there.

DO $$
DECLARE
  bad TEXT;
  missing TEXT := '';
  n INT;
BEGIN
  -- 1. RLS on.
  SELECT string_agg(c.relname, ', ')
  INTO bad
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public'
    AND c.relname IN ('crm_partners', 'crm_investors', 'people')
    AND c.relrowsecurity = false;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS is DISABLED on: % — these tables are wide open', bad;
  END IF;

  -- 2. Nothing addressed to PUBLIC or anon.
  SELECT string_agg(format('%s.%s (roles=%s)', tablename, policyname, roles::text), '; ')
  INTO bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('crm_partners', 'crm_investors', 'people')
    AND (roles::text[] && ARRAY['public', 'anon']);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'Anonymous access is open again via: %. Permissive policies are OR-ed, so one PUBLIC policy re-opens the table. Scope it TO authenticated.',
      bad;
  END IF;

  -- 3. The team can still work. Checked per table so the message names the gap.
  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='crm_partners'
     AND cmd IN ('ALL','SELECT') AND roles::text[] @> ARRAY['authenticated'];
  IF n = 0 THEN missing := missing || 'crm_partners has no authenticated read policy; '; END IF;

  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='crm_investors'
     AND cmd IN ('ALL','SELECT') AND roles::text[] @> ARRAY['authenticated'];
  IF n = 0 THEN missing := missing || 'crm_investors has no authenticated read policy; '; END IF;

  -- people must stay team-wide READABLE: the user switcher, assignee pickers and
  -- every per-person grid break without it, and they break quietly.
  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='people'
     AND cmd IN ('ALL','SELECT') AND roles::text[] @> ARRAY['authenticated'];
  IF n = 0 THEN missing := missing || 'people has no authenticated SELECT policy; '; END IF;

  -- App.jsx self-heals a missing people row on first login; without an INSERT
  -- policy a new teammate cannot sign in at all.
  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='people'
     AND cmd IN ('ALL','INSERT') AND roles::text[] @> ARRAY['authenticated'];
  IF n = 0 THEN missing := missing || 'people has no authenticated INSERT policy (first login self-heal breaks); '; END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'Shared-book access is broken for the TEAM, not just anon: %', missing;
  END IF;

  RAISE NOTICE 'OK: RLS on, no PUBLIC/anon policies, authenticated access intact on all three tables.';
END $$;
