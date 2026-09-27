-- ============================================
-- 049: give every lead that has a creator an owner
-- ============================================
-- 335 of 824 leads (41%) sit with assigned_to IS NULL. The Pipeline board
-- lists a lead when you either created it OR are assigned to it
-- (src/lib/api/leads.js — `created_by.eq.N,assigned_to.eq.N`), but the owner
-- LABEL renders from assigned_to alone. So an analyst sees their own leads in
-- their own book, labelled "Unassigned", and reasonably concludes the app
-- lost them.
--
-- createLead has defaulted assigned_to to the creator since July 2026
-- (leads.js), so nothing NEW lands unassigned. This is the backlog that
-- predates that fix.
--
-- 132 of the 335 carry a created_by. For those, ownership is not a guess:
-- the person who typed the lead in owns it. The remaining 203 have no
-- created_by either (June/July 2026 CSV imports that recorded no actor) and
-- are deliberately left alone — no row in this database says who added them,
-- and inventing an owner would be worse than showing none. They surface in
-- the Today tab's unassigned banner to be claimed by a human.
--
-- assigned_by is set to the creator too (they assigned it to themselves, in
-- effect) and assigned_date to created_at, so the attribution reads
-- coherently rather than claiming the lead was assigned today.
--
-- Non-destructive: only touches rows where assigned_to IS NULL. An existing
-- owner is never overwritten, so a lead someone has since been given away
-- keeps its current owner.
--
-- APPLIED to production 2026-09-27 via `supabase db push`
-- (supabase/migrations/20260927000000_backfill_lead_owner_from_creator.sql).
-- Verified after the fact against the live table: unassigned fell 335 -> 203,
-- zero rows left with a creator but no owner, and the 132 recovered leads
-- landed on their creators (person 16 +94, person 2 +23, person 1 +8, four
-- others +7). No lead changed hands.
--
-- Run via the /migrate skill. Idempotent: after this, no row matches
-- assigned_to IS NULL AND created_by IS NOT NULL, so a re-run updates zero.

UPDATE crm_leads
   SET assigned_to   = created_by,
       assigned_by   = created_by,
       assigned_date = COALESCE(assigned_date, created_at)
 WHERE assigned_to IS NULL
   AND created_by IS NOT NULL;

-- Verification:
--   -- expect 0
--   SELECT COUNT(*) FROM crm_leads WHERE assigned_to IS NULL AND created_by IS NOT NULL;
--   -- expect ~203, all with created_by NULL: the genuine orphans
--   SELECT COUNT(*) FROM crm_leads WHERE assigned_to IS NULL;
--   -- nobody gained a lead they did not create
--   SELECT COUNT(*) FROM crm_leads WHERE assigned_to IS NOT NULL AND created_by IS NOT NULL
--     AND assigned_to <> created_by;  -- pre-existing reassignments only
