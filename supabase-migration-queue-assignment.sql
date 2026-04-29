-- ============================================
-- OUTREACH QUEUE: assigned_to backfill
-- ============================================
-- The Outreach Queue is moving from a created_by filter (each analyst sees
-- what they uploaded) to an assigned_to filter (each analyst sees what was
-- assigned to them). For existing rows that have no assigned_to set,
-- backfill it from created_by so they don't drop off everyone's queue
-- after the app code switches.
--
-- Safe to run multiple times.

UPDATE crm_leads
SET assigned_to = created_by
WHERE assigned_to IS NULL
  AND created_by IS NOT NULL
  AND stage = 'new_lead';

-- Verification:
-- SELECT COUNT(*) AS total,
--        COUNT(assigned_to) AS assigned,
--        COUNT(*) FILTER (WHERE assigned_to IS NULL) AS unassigned
-- FROM crm_leads
-- WHERE stage = 'new_lead';
