-- ============================================
-- people.email: one casing, one row per person
-- ============================================
-- people.email is the join key between a Supabase auth user and their CRM
-- identity, but nothing ever enforced its shape:
--
--   * RLS's current_person_id() matches on LOWER(email) ... LIMIT 1
--   * App.jsx matched with a case-SENSITIVE === (fixed in this PR)
--   * api/admin/reset-password.js and api/events/fire.js used .eq('email', ...)
--   * src/lib/api/leads.js uses .ilike
--
-- and there is no unique constraint anywhere. So signing in once with different
-- casing minted a SECOND people row, after which current_person_id()'s LIMIT 1
-- could resolve to a different row than the UI believed you were — leads
-- attaching to a person id the user never sees — and maybeSingle() lookups
-- errored on the duplicate and silently degraded to "not an admin".
--
-- This migration normalises the column and then makes the bad state
-- unrepresentable. Run via the /migrate skill. Idempotent.

-- ---------- 1. normalise existing rows ----------
UPDATE people
SET email = LOWER(TRIM(email))
WHERE email IS DISTINCT FROM LOWER(TRIM(email));

-- ---------- 2. keep it that way ----------
CREATE OR REPLACE FUNCTION people_normalise_email()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    NEW.email := LOWER(TRIM(NEW.email));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_people_normalise_email ON people;
CREATE TRIGGER trg_people_normalise_email
  BEFORE INSERT OR UPDATE OF email ON people
  FOR EACH ROW
  EXECUTE FUNCTION people_normalise_email();

-- ---------- 3. one row per email ----------
-- Deliberately NOT silently merged: duplicate people rows are referenced by
-- leads, outreach and activities, so deciding which row survives is a judgement
-- call about whose work is whose — not something a migration should guess. If
-- duplicates exist this fails LOUDLY and names them, rather than half-applying.
DO $$
DECLARE
  dupes TEXT;
BEGIN
  SELECT string_agg(email || ' (' || cnt || ' rows, ids: ' || ids || ')', '; ')
  INTO dupes
  FROM (
    SELECT email,
           COUNT(*)                        AS cnt,
           string_agg(id::text, ',' ORDER BY id) AS ids
    FROM people
    WHERE email IS NOT NULL
    GROUP BY email
    HAVING COUNT(*) > 1
  ) d;

  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot add unique index: duplicate people.email rows exist -> %. Merge them (repoint crm_leads.assigned_to / crm_outreach_log.person_id / crm_lead_activities to the surviving id, then delete the loser) and re-run.',
      dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS people_email_unique_idx ON people (email);

-- Verification:
--   SELECT email, COUNT(*) FROM people GROUP BY email HAVING COUNT(*) > 1;  -- expect 0 rows
--   \d people   -- expect people_email_unique_idx and trg_people_normalise_email
