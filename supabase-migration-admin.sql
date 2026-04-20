-- Admin role for Pocket Fund CRM
-- Adds is_admin flag to people. Seeds dev@pocket-fund.com as the initial admin.
-- Run in Supabase SQL Editor.

ALTER TABLE people
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

UPDATE people SET is_admin = true WHERE email = 'dev@pocket-fund.com';

CREATE INDEX IF NOT EXISTS idx_people_is_admin ON people(is_admin) WHERE is_admin = true;

COMMENT ON COLUMN people.is_admin IS 'True if this user has access to the Admin page.';
