# Pocket Fund Sales CRM (boston workspace)

Pocket Fund's sales CRM — the source of truth for buyers, sellers, investors, and partners (deliberately NOT in the wiki). Users: Dev, Aum, Gaurav, Pushkar, and the other analysts on the outreach team. React SPA + Vercel serverless functions + Supabase.

## Repo topology

Unlike marseille, this worktree is simple: `origin` = github.com/dev-pf66/pocket-fund-crm.git — **this IS the repo Vercel deploys from**. No divergent second remote. Target branch for PRs: `main`.

- Still `git fetch` before any claim about divergence or "already deployed".

## Deploy

- Vercel deploys from origin/main; live at https://pocket-fund-crm.vercel.app.
- Never claim a fix is live without verifying the deployed site (global `/ship-verify` skill). A push is not a deploy; a deploy is not a verified fix.
- Vercel crons (`vercel.json`): `weekly-digest` only (Mon 03:30 UTC = 9:00 IST → posts per-analyst rollup as a due-dated Sage task, idempotent via `crm_tt_mappings`). The digest covers **every non-archived person, zeros included** (Dev's call, July 2026) — don't filter it back down to active-only.
- `TASK_TRACKER_API_URL`/`TASK_TRACKER_API_KEY` + `CRON_SECRET` live in Vercel prod env — they were missing until July 2026, which silently disabled ALL task-tracker automation. If TT automation looks dead, check these first.
- **Fail-loud config (Aug 2026):** every `api/*` handler opens with `requireEnv(res, [...])` from `api/_env.js` — missing env is now a 500 naming the vars, never a silent degrade. `GET /api/health` (auth: `Bearer $CRON_SECRET`) reports missing env + the digest's last run. Adding a handler? Add its `requireEnv` line and its vars to `REQUIRED` in `api/health.js`.
- **Cron heartbeat (Aug 2026):** every digest run writes a row to `crm_cron_runs` (ok/failed/skipped), and a FAILED run files its own high-priority Sage task, idempotent per week via `crm_tt_mappings` entity_type `weekly_digest_failure`. Remaining gap by design: if the cron never fires at all, nothing alerts — the digest task's absence on a Monday IS the signal.
- The `daily-leads-v2` cron was **removed August 2026** (Dev's call). It had never once worked: it inserted columns that don't exist on `crm_leads` (`company`/`source`/`score`/`tags`), and `APIFY_API_TOKEN` was never set in prod, so the scraper returned nothing anyway. Recover from git history if it's ever wanted; it needs an Apify token to do anything.

## Supabase

- Project ref: `lzydgdzjrgvqglxmyfjk` (https://lzydgdzjrgvqglxmyfjk.supabase.co).
- Client env (local `.env`, gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Server env (`.env.local` via `vercel env pull`, and Vercel prod): `ANTHROPIC_API_KEY`, `CRM_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Migrations live in `migrations/` (numbered `NNN_*.sql`, currently through 044). Schema changes go through the `/migrate` skill — idempotent SQL only; never hand Dev raw SQL to paste into the dashboard.
- `crm_investors` RLS is deliberately "Allow all access" (open to the team as the shared contact book) — do not "fix" it.

## CRM API (preferred access path for CRM data)

- HTTP API at `https://pocket-fund-crm.vercel.app/api/{leads,activities,investors,analytics,enrich-linkedin,analyze-outreach,analyze-transcript}` — use this for reading/writing CRM data, NOT direct Supabase queries.
- Auth: `x-api-key` header (`CRM_API_KEY`). Agent-side key lives in `~/clawd/.env` as `CRM_API_KEY` (base URL: `CRM_API_URL`). Cron endpoints use `Authorization: Bearer CRON_SECRET` instead.
- Full reference: `api/README.md` in this repo. The global `/crm` skill also operates this API from any workspace.

## Pipeline machinery (known traps)

- Stage order lives in `STAGE_ORDER` in `src/lib/api/leads.js`: new_lead → cold_outreach → responded → warm_lead → active_conversation → meeting_booked → client; `passed` is terminal/outside.
- `src/lib/crm-api.js` is a **pure re-export barrel** over `src/lib/api/*` modules — edit the modules, not the barrel.
- **Pagination:** `fetchAllRows()` (`src/lib/api/core.js`, mirrored for serverless in `api/_db.js`) is the ONLY sanctioned way to read a list that gets counted/aggregated. PostgREST truncates a plain select at 1000 rows with NO error, and this repo has shipped that bug three separate times. `.limit(n)` is NOT an escape hatch — PostgREST clamps it to max-rows, so `.limit(5000)` quietly returns 1000; use `fetchAllRows(f, { maxRows })`. Pass a FACTORY (a query builder is single-use), and give any ordered query a total sort (add `.order('id')`) or paging can skip/duplicate rows at a page boundary.
- **Volume forecast:** cold calling adds ~100 rows/day to `crm_outreach_log` team-wide. The
  `MAX_LOG_ROWS = 5000` ceiling in `src/lib/api/outreach.js` bounds the Tracker/Log table reads;
  at this rate the 30-day "All" view gets there in roughly two months, and past it the table
  silently shows a slice. Filter by type, or raise the ceiling, before it bites.
- All stage automation is **forward-only** (`advanceLeadStage`) — never regresses a lead, never touches client/passed. It deliberately skips `runStageSideEffects` to avoid double-counting.
- Reply↔pipeline sync is bidirectional: outreach marked 'replied' advances the lead to `responded`; lead dragged to responded+ flips its latest un-replied outreach entry to 'replied'.
- Entering `meeting_booked` auto-logs a 'meeting' activity — that's what the Dashboard Funnel counts as meetings.
- Per-user outreach targets: `people.daily_outreach_target` / `weekly_outreach_target` (migration 032), set in Admin → All Users → Targets; NULL falls back to 10/50. The old Goals page is removed and the unused `crm_goals`/`crm_goal_*` tables were dropped (Dev's call, July 2026) — don't recreate them.
- **Cold calls (Sept 2026, `src/pages/ColdCalls.jsx`)** — they dial on CallHippo, ~20 dials
  per person per day, at buyers (`crm_leads`). Calls live in `crm_outreach_log`, **one row per
  DIAL**, `outreach_type='phone_call'` — so dials count toward the daily target, the streak and
  the digest for free (Dev's call: dials count, but pickups/conversations are what we manage on).
  - The outcome vocabulary and its predicates live in **`src/lib/callOutcomes.js`** and are
    mirrored by a CHECK constraint in migration 044. A test fails if the two drift apart.
  - **A gatekeeper is a pickup, NOT a conversation.** Same for a wrong number. Folding them
    together flatters the funnel by exactly the amount that matters. `isPickup` vs
    `isConversation` is the whole distinction the page exists to make.
  - Every call row still carries the legacy `status`, derived from the outcome via
    `statusForOutcome()`, so reply rate / the weekly digest / the pipeline response filter keep
    reading one column and never learn what a gatekeeper is. Never write `status` on a call row
    by hand — `logCall`/`updateCall` derive it.
  - `not_interested` maps to `replied` on purpose: they responded. It advances the lead to
    `responded`, and the caller moves it to `passed` from there.
  - `do_not_call` is a real column on `crm_leads`, filtered in SQL — the call queue must never
    load someone who asked not to be called.
  - Recordings are a pasted CallHippo URL on the call row (`recording_url`). A CallHippo webhook
    that auto-logs dials is the obvious next step and is why `provider_call_id` (unique) exists.
- Today tab (`src/pages/Today.jsx`): shows each person's work for that day — that's its whole job; don't redesign it into another pipeline view. Shipped July 2026 (`feature/today-tab` PR merged).
- Dev's standing product decisions (July 2026): Tracker/Queue/Log stay three separate pages; all five contact tables stay (leads, sellers, investors, partners, demos).

## Dev environment

- Stack: Vite 7 + React 19 + react-router 7 + supabase-js; serverless functions in `api/` (plain JS, Vercel style).
- Checks: `npm run lint` (0 errors, warnings remain), `npm test` (vitest), `npm run build`. All three run on every PR to main via `.github/workflows/ci.yml` — Vercel deploys from origin/main with no gate of its own, so CI is the gate.
- The test suite (`test/`) is **guardrails, not coverage** (Aug 2026). It pins the trap-prone machinery that keeps getting broken: forward-only `advanceLeadStage`, the reply↔pipeline sync and meeting auto-log in `moveLead`, the digest's "everyone, zeros included" + TEAM-sums-only-listed-rows rules, and `fetchAllRows` paging. Don't chase coverage; do add a guardrail when you fix a silent-failure bug. `test/helpers/fake-supabase.js` is a recording mock, not a query engine — it records operations, it does not filter or sort.
- Run: `npm install && npm run dev`. Build: `npm run build`. Lint: `npm run lint`.
- `.env` is gitignored — fresh worktrees need the two `VITE_` values (unquoted). `.env.local` comes from `vercel env pull`.
- Local `npm run dev` runs the SPA only; `api/*` functions do not run locally without `vercel dev`.
- `@sentry/react` is installed but there is **no Sentry project yet** — don't look for one when debugging production, and don't claim errors are tracked.
- The Apify lead finder (`scripts/apify-lead-finder.js`, `APIFY-SETUP.md`) is **abandoned** (Dev: good idea, not pursued). Don't revive or maintain it. `apify-client` stays in package.json only because that script imports it — nothing else in the app uses Apify since `daily-leads-v2` was removed.
- `bot/` is a separate Telegram bot (grammY + Claude + Supabase service key) with its own package.json — **not currently running anywhere** and not part of the Vercel deploy. Dev's call (July 2026): low priority — keep the code but don't maintain, fix, or extend it unless he asks.

## Related docs

- `api/README.md` — full HTTP API reference.
- `docs/PRODUCT-AUDIT.md` — product audit (some recommendations explicitly rejected by Dev, see above).
- `APIFY-SETUP.md`, `SECURITY-SETUP.md`, `LEAD-IMPROVEMENTS-README.md`, `OUTREACH-TRACKER-README.md` — feature-specific setup notes.
- CRM↔task-tracker integration: tracker side lives in the `marseille` workspace / task-tracker-hazel.vercel.app (see `CRM-TT-INTEGRATION-HANDOFF.md` there).

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

This project has a knowledge graph. **Prefer the code-review-graph MCP
tools over Grep/Glob/Read when the server is connected** — the graph is
faster, cheaper (fewer tokens), and gives you structural context
(callers, dependents, test coverage) that file scanning cannot. The
server is sometimes flaky/disconnected; when it is, fall back to
Grep/Glob/Read without ceremony instead of waiting on it.

### When to prefer graph tools

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read when the graph doesn't cover what you need or the server is down.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
