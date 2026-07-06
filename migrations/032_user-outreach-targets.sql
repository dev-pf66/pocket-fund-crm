-- ============================================
-- PER-USER OUTREACH TARGETS
-- ============================================
-- The Goals page is gone; outreach targets are now admin-set per user
-- (Admin → All Users → Targets) and drive the Dashboard daily ring,
-- streak, and weekly bar, plus the Tracker/Log progress displays.
-- NULL means "use the app defaults" (10/day, 50/week).
--
-- Note: crm_investors needed no change here — its existing RLS policy
-- ("Allow all access", USING true) already allows the whole team; the
-- admin-only restriction removed in this release was frontend-only.
--
-- Safe to run multiple times.

ALTER TABLE people ADD COLUMN IF NOT EXISTS daily_outreach_target INTEGER;
ALTER TABLE people ADD COLUMN IF NOT EXISTS weekly_outreach_target INTEGER;

INSERT INTO schema_migrations (name) VALUES ('032_user-outreach-targets')
ON CONFLICT (name) DO NOTHING;
