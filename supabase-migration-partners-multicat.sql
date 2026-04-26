-- ============================================
-- POTENTIAL PARTNERS: multi-category
-- ============================================
-- Converts crm_partners.category (single VARCHAR) to crm_partners.categories
-- (TEXT[]) so a partner can belong to multiple categories at once
-- (e.g. a creator who is also a podcast host).
--
-- Run after supabase-migration-partners.sql. Safe to run multiple times.

-- 1. Add the new array column with a sane default.
ALTER TABLE crm_partners
  ADD COLUMN IF NOT EXISTS categories TEXT[] NOT NULL DEFAULT '{}';

-- 2. Backfill from the old `category` column for any rows that pre-date this
--    migration. NULL-coalesce because the column may already be gone on a
--    re-run; the WHERE clause skips rows already populated.
UPDATE crm_partners
SET categories = ARRAY[category]
WHERE category IS NOT NULL
  AND (categories IS NULL OR array_length(categories, 1) IS NULL);

-- 3. Drop the old single-category column and its index.
DROP INDEX IF EXISTS idx_crm_partners_category;
ALTER TABLE crm_partners DROP COLUMN IF EXISTS category;

-- 4. GIN index for fast `categories @> '{x}'` lookups.
CREATE INDEX IF NOT EXISTS idx_crm_partners_categories
  ON crm_partners USING GIN (categories);

-- Verification:
-- SELECT id, name, categories FROM crm_partners LIMIT 5;
