-- ============================================
-- PARTNERS → SHARED TEAM PIPELINE
-- ============================================
-- crm_partners started as a personal, per-owner kanban (migration 020): RLS
-- isolated each user to their own rows, and the tab was gated to Dev only.
-- Dev's call (July 2026): promote it to a shared team pipeline like
-- crm_investors — everyone on the team sees and works the same book.
--
-- This drops the four per-user policies and replaces them with a single
-- allow-all policy, matching crm_investors exactly:
--   "Allow all access to crm_investors"  cmd=ALL  roles={public}  using=true  check=true
--
-- Run in Supabase SQL Editor or via the /migrate skill. Idempotent.

ALTER TABLE crm_partners ENABLE ROW LEVEL SECURITY;

-- Remove the old per-owner isolation policies.
DROP POLICY IF EXISTS "users_view_own_partners"   ON crm_partners;
DROP POLICY IF EXISTS "users_create_partners"     ON crm_partners;
DROP POLICY IF EXISTS "users_update_own_partners" ON crm_partners;
DROP POLICY IF EXISTS "users_delete_own_partners" ON crm_partners;

-- Single shared-access policy (mirrors crm_investors).
DROP POLICY IF EXISTS "Allow all access to crm_partners" ON crm_partners;
CREATE POLICY "Allow all access to crm_partners" ON crm_partners
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Verification:
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies WHERE tablename = 'crm_partners';
