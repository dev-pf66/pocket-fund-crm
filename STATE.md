# STATE — pocket-fund-crm (praia)
_updated: 2026-09-29_

## Goal
Ship the Sales CRM rework from the 27 Sept Om meeting, plus whatever the build turned up.
Deploys from `dev-pf66/pocket-fund-crm` → https://pocket-fund-crm.vercel.app.

## Now
Nothing in flight. The list is finished and verified live: bundle `index-DxkyndS2.js`
(matches the local build of `e373b7d`), page 200, authenticated `/api/leads` returns JSON,
`/api/health` `ok:true` with 0 missing env, anon reads 0 rows on `crm_partners`,
`crm_investors`, `people` and `crm_leads`.

## Done recently
- 2026-09-29 — **PR #31** merged. Doc only: `CLAUDE.md`'s cron list said `weekly-digest`
  only (a second daily cron, `callhippo-sync`, has been live), and the cold-calls section
  still called the CallHippo auto-import "the obvious next step" when it had shipped.
- 2026-09-29 — **PR #29** merged. "Needs Attention" filter on the Leads board
  (`src/lib/leadFilters.js`, `test/lead-filters.test.js`) — the bridge from a scoreboard
  breach *count* to the rows. Options: No channel set (476) · Missing required info (96) ·
  No way to reach them (30) · Past the 30-day clock this month (41) · Stale backlog (32).
- 2026-09-29 — PRs #24–#28 merged: phantom-quota sweep, editable `crm_settings` thresholds,
  anon-exposure fix (migrations 054–056), lead health + tags-as-lists, channel backfill +
  bulk setter + reassign-on-archive + settings attribution.
- Migrations 050–058 all applied to production and verified with real queries.
- Data fixed in prod: 132 leads given back an owner · 275 stale leads archived · 152
  channels derived from the importer's contract · Pravar's 3 orphaned records → Siddhant.
- Suite 446 passing, lint 0 errors, build clean.

## In flight / blocked
- **PR #18 (`fix/anon-data-exposure-and-identity-casing`) — needs Dev to close it.**
  Closing it is denied to the agent (`gh pr close` blocked). It is superseded: its substance
  shipped hardened in #26. It is now a hazard — its `migrations/050`/`051` collide with
  numbers already applied to production (050 = lead-owner backfill, 051 = `archived_by`),
  and GitHub still reports it `MERGEABLE`/`CLEAN`, so merging it would re-drop the policies
  054–056 created. Nothing is lost by closing; the branch stays and it reopens in a click.
- **476 live leads still have no `lead_channel`, 96 of them engaged** (Sidharth 31, Aum 26,
  Dev 14, Aditya 8, 6 unowned). Nothing can derive these — the importer's contract only
  proved the 152 bulk-LinkedIn rows (migration 058). Needs a human; the board filter plus
  the selection bar's Set channel is the fast path.
- **62 of 74 CallHippo-imported dials are unclaimed and unclassified** (35 linked to a
  lead). By design — one shared seat, so the API cannot say who dialled — but until someone
  claims them on ColdCalls → Claim they sit outside every per-person count.

## Next
1. Dev closes PR #18.
2. Someone fills `lead_channel` on the 96 engaged leads: Pipeline → filters → Needs
   Attention → "No channel set", narrow by Analyst, select, Set channel.
3. Team claims the 62 imported dials.

## Traps
- `main` is checked out in the sibling worktree `~/conductor/repos/pocket-fund-crm`, so
  `git checkout main` fails here. Work on `dev-pf66/finish-up` and PR into main.
- A **duplicate Vercel project double-builds** this repo — read the production deployment.
- Both apps return the SPA shell with **HTTP 200** for unknown API routes. JSON body = real
  endpoint; HTML = the route does not exist.
- `.env.local` values need `tr -d '"\r' | xargs` before use in curl — raw `cut` leaves
  quoting that produces a misleading 401.
- CI is the only gate: Vercel deploys from origin/main with no gate of its own.
