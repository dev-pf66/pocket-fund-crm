-- ============================================
-- ARCHIVE USERS
-- ============================================
-- Lets an admin archive a teammate: their data is fully retained, but they
-- no longer appear on leaderboards / switchers and can't use the app.
-- Enforced at the app layer (App.jsx bounces archived accounts on login and
-- filters them out of the people list).

ALTER TABLE people
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_people_is_archived
  ON people(is_archived) WHERE is_archived = true;

-- Note: archived users keep their auth account, so this only blocks the
-- CRM app, not Supabase Auth itself. That's intentional — flipping the flag
-- back un-archives instantly without recreating their login.
