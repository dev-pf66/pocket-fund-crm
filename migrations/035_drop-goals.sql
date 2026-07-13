-- 035: Drop the unused goals tables.
-- The Goals page was removed July 2026 (replaced by per-user outreach targets
-- on people, migration 032). Dev confirmed removal 2026-07-13.
-- Reverses migration 015_goals-v2.sql. Idempotent.

DROP TRIGGER IF EXISTS crm_goals_updated_at ON crm_goals;
DROP TRIGGER IF EXISTS crm_goal_progress_updated_at ON crm_goal_progress;
DROP TABLE IF EXISTS crm_goal_progress;
DROP TABLE IF EXISTS crm_goals;
