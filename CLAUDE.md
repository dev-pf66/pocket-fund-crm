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
- The `daily-leads-v2` cron was **removed August 2026** (Dev's call). It had never once worked: it inserted columns that don't exist on `crm_leads` (`company`/`source`/`score`/`tags`), and `APIFY_API_TOKEN` was never set in prod, so the scraper returned nothing anyway. Recover from git history if it's ever wanted; it needs an Apify token to do anything.

## Supabase

- Project ref: `lzydgdzjrgvqglxmyfjk` (https://lzydgdzjrgvqglxmyfjk.supabase.co).
- Client env (local `.env`, gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Server env (`.env.local` via `vercel env pull`, and Vercel prod): `ANTHROPIC_API_KEY`, `CRM_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Migrations live in `migrations/` (numbered `NNN_*.sql`, currently through 035). Schema changes go through the `/migrate` skill — idempotent SQL only; never hand Dev raw SQL to paste into the dashboard.
- `crm_investors` RLS is deliberately "Allow all access" (open to the team as the shared contact book) — do not "fix" it.

## CRM API (preferred access path for CRM data)

- HTTP API at `https://pocket-fund-crm.vercel.app/api/{leads,activities,investors,analytics,enrich-linkedin,analyze-outreach,analyze-transcript}` — use this for reading/writing CRM data, NOT direct Supabase queries.
- Auth: `x-api-key` header (`CRM_API_KEY`). Agent-side key lives in `~/clawd/.env` as `CRM_API_KEY` (base URL: `CRM_API_URL`). Cron endpoints use `Authorization: Bearer CRON_SECRET` instead.
- Full reference: `api/README.md` in this repo. The global `/crm` skill also operates this API from any workspace.

## Pipeline machinery (known traps)

- Stage order lives in `STAGE_ORDER` in `src/lib/api/leads.js`: new_lead → cold_outreach → responded → warm_lead → active_conversation → meeting_booked → client; `passed` is terminal/outside.
- `src/lib/crm-api.js` is a **pure re-export barrel** over `src/lib/api/*` modules — edit the modules, not the barrel.
- All stage automation is **forward-only** (`advanceLeadStage`) — never regresses a lead, never touches client/passed. It deliberately skips `runStageSideEffects` to avoid double-counting.
- Reply↔pipeline sync is bidirectional: outreach marked 'replied' advances the lead to `responded`; lead dragged to responded+ flips its latest un-replied outreach entry to 'replied'.
- Entering `meeting_booked` auto-logs a 'meeting' activity — that's what the Dashboard Funnel counts as meetings.
- Per-user outreach targets: `people.daily_outreach_target` / `weekly_outreach_target` (migration 032), set in Admin → All Users → Targets; NULL falls back to 10/50. The old Goals page is removed and the unused `crm_goals`/`crm_goal_*` tables were dropped (Dev's call, July 2026) — don't recreate them.
- Today tab (`src/pages/Today.jsx`): shows each person's work for that day — that's its whole job; don't redesign it into another pipeline view. Shipped July 2026 (`feature/today-tab` PR merged).
- Dev's standing product decisions (July 2026): Tracker/Queue/Log stay three separate pages; all five contact tables stay (leads, sellers, investors, partners, demos).

## Dev environment

- Stack: Vite 7 + React 19 + react-router 7 + supabase-js; serverless functions in `api/` (plain JS, Vercel style). No test suite — `npm run lint` is the only check.
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
