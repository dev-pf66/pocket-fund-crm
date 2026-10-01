# Migrations

Every schema change for the Pocket Fund Sales CRM lives here, numbered in creation order
(`NNN_name.sql`, currently through **058** — 62 files in total, because parallel branches each
reused 034, 046 and 049. The number is a human label, not a key; the CLI orders by its own
timestamp, so a collision here is untidy rather than dangerous). Write idempotent SQL — `CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY` — so a re-run is always
safe.

**The numbered file in this directory is the committed source of truth.** Everything below is
about getting it into the database.

## Applying one — the Supabase CLI does it, no dashboard paste

The CLI is linked to `lzydgdzjrgvqglxmyfjk` ("pf sales CRM") and the DB credential is cached in
the macOS keychain, so it connects on its own. There is no `SUPABASE_ACCESS_TOKEN` and no Postgres
URL in any env file — earlier sessions concluded from that that migrations were blocked. They
aren't.

```bash
# 1. link (once per worktree — supabase/ is gitignored, so a fresh worktree has none)
supabase link --project-ref lzydgdzjrgvqglxmyfjk --yes

# 2. copy the numbered file across under a UNIQUE timestamp
cp migrations/049_archive-leads.sql \
   "supabase/migrations/$(date +%Y%m%d%H%M%S)_archive_leads.sql"

# 3. dry run — confirm it lists ONLY your migration
supabase db push --dry-run

# 4. push
supabase db push
```

`supabase db dump` and `db diff` need Docker Desktop and will fail without it. `db push` does not.

### Two traps that have already bitten

**Use a real timestamp, not midnight.** A file stamped `YYYYMMDD000000` can collide with a version
already in the remote history. When that happens `db push --dry-run` reports
*"Remote database is up to date"* and applies **nothing** — a silent no-op that looks exactly like
success. This happened on 2026-09-26. `$(date +%Y%m%d%H%M%S)` avoids it.

**`Remote migration versions not found in local migrations directory`** means the remote history
contains versions this worktree has no file for (normal — they were pushed from another worktree,
and `supabase/` is gitignored). Do **not** run `supabase migration repair --status reverted`, and
do **not** run `supabase db pull` (needs Docker). Drop in a placeholder file per missing version:

```bash
printf -- "-- Applied from another worktree; placeholder for the CLI history check.\n" \
  > supabase/migrations/<version>_applied_elsewhere.sql
```

Never run `supabase config push` — with no `config.toml` in this repo it pushes CLI defaults and
overwrites the project's entire auth configuration.

## Verifying it landed — query the thing itself

**Never trust the CLI's success line.** Confirm with a real query against what the migration was
supposed to create:

```bash
# does the column exist and read back?
curl -s "$CRM_API_URL/api/leads?id=33" -H "x-api-key: $CRM_API_KEY" | python3 -m json.tool
```

Or with the service-role key: select the new column, and prove a new CHECK constraint rejects what
it should. A migration that reports success and changed nothing is the failure mode this section
exists for.

## The `schema_migrations` table is abandoned — do not trust it

This directory used to document a hand-maintained `schema_migrations` table, with the workflow
"anything not in that query's output has not been applied."

**That is now actively wrong and will mislead you.** As of 2026-09-29 the table holds **5 rows**
(032, 033, 034, 046, 047) against 62 migration files. The one-time backfill it described was never run,
and almost nothing since has been recorded. Reading it would tell you that 001–031 and most of
035–058 are unapplied; every one of them is live.

There are now two tracking mechanisms and neither is complete:

| | |
|---|---|
| `schema_migrations` (this repo's own) | 5 rows. Abandoned. Ignore it. |
| `supabase_migrations.schema_migrations` (CLI) | Only versions pushed via `db push`, so it starts partway through the history. |

The reliable answer to "is this applied?" is the query in the section above, against the actual
column, table or constraint. Nothing else.
