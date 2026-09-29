-- ============================================
-- 057: who changed what "stale" means
-- ============================================
-- crm_settings became editable in Sept 2026 (updateCRMSettings +
-- StalenessSettings). It records `updated_at` but not who did it — and this is a
-- SINGLE ROW that changes the staleness colouring for the entire team, on every
-- board. "Why is everything red this morning" had no answer.
--
-- Same gap, same lesson, as `archived_by` (051): the operations that change what
-- everyone else sees are exactly the ones that need a name on them. RLS on this
-- table is `FOR UPDATE USING (auth.uid() IS NOT NULL)` (migration 010), so any
-- signed-in user can write it — the only gate is that Admin is admin-only at the
-- route. That makes the attribution matter more, not less.
--
-- ON DELETE SET NULL, mirroring assigned_by / archived_by: the setting outlives
-- the person who changed it.
--
-- Nullable and unbackfilled. The existing row was written 2026-02-05 by nobody
-- this schema can name, and guessing would be worse than a NULL.
--
-- Run via the /migrate skill. Idempotent.

ALTER TABLE crm_settings ADD COLUMN IF NOT EXISTS updated_by INTEGER
  REFERENCES people(id) ON DELETE SET NULL;

-- Verification:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'crm_settings' AND column_name = 'updated_by';
--   SELECT id, updated_at, updated_by FROM crm_settings;
