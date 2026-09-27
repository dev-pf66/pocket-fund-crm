-- ============================================
-- 051: record WHO archived a lead
-- ============================================
-- Migration 049_archive-leads.sql gave the archive its flag, its timestamp and
-- its reason. It did not record the actor, and `runArchiveSweep`
-- (src/lib/api/archive.js) already takes a currentPersonId, carries it all the
-- way through, and then returns it to the caller instead of storing it — so
-- the one operation in this app that flips several hundred production rows at
-- once was the one operation with no name attached to it.
--
-- "Who ran this sweep, and when" is the first question anyone asks when 300
-- leads vanish off their board. archived_at answered half of it.
--
-- ON DELETE SET NULL, mirroring crm_leads.assigned_by (migration 005): an
-- archived lead must survive the person who archived it leaving.
--
-- Nullable and unbackfilled on purpose. No row archived before today has an
-- actor on file anywhere, and guessing one would put a name against an action
-- that person may not have taken.
--
-- Run via the /migrate skill. Idempotent.
--
-- APPLIED to production 2026-09-27 via `supabase db push`
-- (supabase/migrations/20260927000100_lead_archive.sql, which also re-ran
-- 049's ADD COLUMN IF NOT EXISTS lines as no-ops). Verified by selecting
-- is_archived, archived_at, archived_by, archived_reason back off crm_leads
-- through PostgREST without a column error.

ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS archived_by INTEGER
  REFERENCES people(id) ON DELETE SET NULL;

-- Verification:
--   SELECT column_name, is_nullable FROM information_schema.columns
--     WHERE table_name = 'crm_leads' AND column_name = 'archived_by';
--   -- after a sweep, every row of that sweep shares one actor and one stamp
--   SELECT archived_at, archived_by, count(*) FROM crm_leads
--     WHERE is_archived GROUP BY archived_at, archived_by ORDER BY archived_at DESC;
