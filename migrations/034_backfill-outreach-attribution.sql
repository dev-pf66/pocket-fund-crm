-- ============================================
-- BACKFILL: OUTREACH → LEAD ATTRIBUTION
-- ============================================
-- Applied 2026-07-07 against production. Historical crm_outreach_log rows
-- were 97% orphaned (lead_id NULL, mostly CSV imports), which broke
-- conversion attribution for everything before the July 2026 reply→pipeline
-- sync. This backfill:
--   A. Linked orphans to existing leads on unambiguous name+firm match
--      (11 entries; ambiguous matches skipped).
--   B. Created leads at stage 'responded' for replied orphans with no
--      matching lead (126 leads / 134 entries), created_by = logged_by,
--      last_activity_date = latest outreach date (honest — many will show
--      stale, which is the point: replies that never got followed up).
--   C. Advanced existing leads at new_lead/cold_outreach with a replied
--      entry to 'responded' (8 leads, forward-only).
--   D. Linked orphans whose name matches exactly one lead that has no firm
--      recorded (90 entries — outreach firm "N/A" vs lead firm NULL).
-- Left alone on purpose: ~1,600 sent-only orphans with no matching lead
-- (no mass lead creation from sent rows), and 5 replied rows from a
-- malformed 2026-04-24 CSV that has no lead_name at all.
--
-- Re-runnable: every step only touches lead_id IS NULL rows, creation is
-- guarded by NOT EXISTS same-name lead, stage advance is forward-only.
-- Full step SQL lives in the session log; this file records the operation
-- for the migration ledger.

INSERT INTO schema_migrations (name) VALUES ('034_backfill-outreach-attribution')
ON CONFLICT (name) DO NOTHING;
