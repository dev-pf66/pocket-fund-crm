# Migrations

All schema changes for the Pocket Fund Sales CRM live here, numbered in the order they were created. Applied by hand in the Supabase SQL editor, tracked in the `schema_migrations` table.

## Workflow

1. **New migration:** create a file with the next number, e.g. `032_my-change.sql`. Write idempotent SQL where possible (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.).
2. **Apply it:** paste the file's contents into the Supabase SQL editor and run it.
3. **Record it:** immediately after applying, run:
   ```sql
   INSERT INTO schema_migrations (name) VALUES ('032_my-change.sql');
   ```
4. **Check what's applied:**
   ```sql
   SELECT name FROM schema_migrations ORDER BY name;
   ```

Anything in this directory that is NOT in that query's output has not been applied — run it before shipping the feature that depends on it.

## One-time setup

Run `000_schema_migrations.sql` first to create the tracking table (idempotent, safe to re-run).

## One-time seed (production is current)

Production already has every migration below applied. Paste this once to backfill the tracking table:

```sql
INSERT INTO schema_migrations (name) VALUES
  ('001_crm-schema.sql'),
  ('002_templates.sql'),
  ('003_lead-improvements.sql'),
  ('004_outreach-tracker.sql'),
  ('005_team-features.sql'),
  ('006_transcripts-table.sql'),
  ('007_transcripts.sql'),
  ('008_fix-activity-triggers.sql'),
  ('009_help-system.sql'),
  ('010_security-rls-policies.sql'),
  ('011_transcript-analysis.sql'),
  ('012_weekly-goals.sql'),
  ('013_admin-rls.sql'),
  ('014_admin.sql'),
  ('015_goals-v2.sql'),
  ('016_outreach-queue.sql'),
  ('017_crm-tt-mappings.sql'),
  ('018_per-user-isolation.sql'),
  ('019_partners-multicat.sql'),
  ('020_partners.sql'),
  ('021_field-options.sql'),
  ('022_lead-type-config.sql'),
  ('023_queue-assignment.sql'),
  ('024_demos-datetime.sql'),
  ('025_demos-firm-info.sql'),
  ('026_demos.sql'),
  ('027_demos-b2b-fields.sql'),
  ('028_demos-contact-fields.sql'),
  ('029_archive-users.sql'),
  ('030_partners-company-fields.sql'),
  ('031_outreach-linkedin.sql')
ON CONFLICT (name) DO NOTHING;
```
