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
- **Every Sage task needs a project (Sept 2026).** `POST /tasks` on the tracker rejects a create that names no `deal_id`/`internal_project_id` — 400 `"deal_id or internal_project_id is required"`. Nothing in this repo sent one, so from mid-August every lead_reply/lead_followup/lead_kickoff/manual_task **and** the weekly digest silently 400'd; three weeks of digests were lost because `alertFailure()` reports a broken digest *by filing a task* and died of the same cause. `tt.createTask` (`src/lib/integrations/task-tracker.js`) now injects the **"PF sales"** internal project (`22f6f543-…`, override with `TASK_TRACKER_PROJECT_ID`) plus `source: 'crm'`, so no call site has to remember. A caller passing its own `deal_id` or `internal_project_id` keeps it.
- **Cron heartbeat (Aug 2026):** every digest run writes a row to `crm_cron_runs` (ok/failed/skipped), and a FAILED run files its own high-priority Sage task, idempotent per week via `crm_tt_mappings` entity_type `weekly_digest_failure`. Remaining gap by design: if the cron never fires at all, nothing alerts — the digest task's absence on a Monday IS the signal.
- The `daily-leads-v2` cron was **removed August 2026** (Dev's call). It had never once worked: it inserted columns that don't exist on `crm_leads` (`company`/`source`/`score`/`tags`), and `APIFY_API_TOKEN` was never set in prod, so the scraper returned nothing anyway. Recover from git history if it's ever wanted; it needs an Apify token to do anything.

## Supabase

- Project ref: `lzydgdzjrgvqglxmyfjk` (https://lzydgdzjrgvqglxmyfjk.supabase.co).
- Client env (local `.env`, gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Server env (`.env.local` via `vercel env pull`, and Vercel prod): `ANTHROPIC_API_KEY`, `CRM_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Migrations live in `migrations/` (numbered `NNN_*.sql`, currently through 045). Schema changes go through the `/migrate` skill — idempotent SQL only; never hand Dev raw SQL to paste into the dashboard.
- **Applying a migration (Sept 2026) — the Supabase CLI can do it, no dashboard paste needed.**
  The CLI is linked to `lzydgdzjrgvqglxmyfjk` ("pf sales CRM") and the DB credential is
  cached in the macOS keychain, so `supabase db push` connects on its own. There is no
  `SUPABASE_ACCESS_TOKEN`, no `.supabase/access-token`, and no Postgres URL in any env
  file — earlier sessions concluded from that that migrations were blocked. They are not.
  - `supabase db push` reads `supabase/migrations/<timestamp>_name.sql`, NOT the repo's
    `migrations/NNN_*.sql`. Copy the numbered file across, `--dry-run` first to confirm it
    lists only your migration, then push. `supabase/` is gitignored — the numbered file in
    `migrations/` stays the committed source of truth.
  - `supabase db dump` / `db diff` need Docker Desktop and will fail without it. `db push`
    does not — it connects directly.
  - Verify with real queries afterwards (select the new column; prove a CHECK rejects what
    it should). Never trust the CLI's success line alone.
  - **`LegacyDbPushMissingLocalError` ("remote migration versions not found in local
    migrations directory") does NOT mean the push is blocked.** `supabase/` is gitignored, so
    that directory is per-machine scratch and drifts from the remote ledger whenever another
    machine or a dashboard edit applies something. `supabase migration list` names the
    remote-only version. Fix it by adding a local placeholder file with that exact timestamp
    (a comment plus `SELECT 1;`) so the two agree. Do **not** take the CLI's suggested
    `migration repair --status reverted <version>` — that version *was* applied, and marking
    it reverted makes the ledger lie about production.
- **Auth email redirects (Sept 2026):** password reset, signup confirmation, and magic links all depend on Supabase Auth → URL Configuration, which is invisible from the code. If `redirectTo` is not in the **Redirect URLs** allowlist, Supabase *silently discards it* and falls back to the **Site URL** — the link still works, it just lands somewhere useless. This is what broke forgot-password for everyone: Site URL was `http://localhost:3000` and the prod domain was not allowlisted, so every reset email dropped the user on a dead localhost address. `Login.jsx` was correct the whole time. Correct values: Site URL `https://pocket-fund-crm.vercel.app`, Redirect URLs `https://pocket-fund-crm.vercel.app/**` + `http://localhost:5173/**`.
  - Probe it without sending mail (anon key only, no secrets):
    `curl -sD- -o/dev/null "https://lzydgdzjrgvqglxmyfjk.supabase.co/auth/v1/verify?token=probe&type=recovery&redirect_to=<urlencoded-url>" -H "apikey: $VITE_SUPABASE_ANON_KEY" | grep -i ^location:`
    If the `location` comes back as your requested URL, it is allowlisted; if it comes back as something else, it is not.
  - Do **not** "fix" this with `supabase config push` — with no `config.toml` in this repo it pushes CLI defaults and overwrites the project's entire auth config.
- `crm_investors` RLS is deliberately "Allow all access" (open to the team as the shared contact book) — do not "fix" it.

## CRM API (preferred access path for CRM data)

- HTTP API at `https://pocket-fund-crm.vercel.app/api/{leads,activities,investors,analytics,enrich-linkedin,analyze-outreach,analyze-transcript}` — use this for reading/writing CRM data, NOT direct Supabase queries.
- Auth: `x-api-key` header (`CRM_API_KEY`). Agent-side key lives in `~/clawd/.env` as `CRM_API_KEY` (base URL: `CRM_API_URL`). Cron endpoints use `Authorization: Bearer CRON_SECRET` instead.
- Full reference: `api/README.md` in this repo. The global `/crm` skill also operates this API from any workspace.

## Pipeline machinery (known traps)

- Stage order lives in `STAGE_ORDER` in `src/lib/api/leads.js`: outreach (merged new_lead+cold_outreach) → responded → meeting_booked (agreed to meet, not yet happened) → warm_active (merged warm_lead+active_conversation, entered once the meeting happens) → client; `passed` is terminal/outside. Sept 2026 restructure (Dev's call) — see `git log` on `src/lib/api/leads.js` for the migration.
- `src/lib/crm-api.js` is a **pure re-export barrel** over `src/lib/api/*` modules — edit the modules, not the barrel.
- **Pagination:** `fetchAllRows()` (`src/lib/api/core.js`, mirrored for serverless in `api/_db.js`) is the ONLY sanctioned way to read a list that gets counted/aggregated. PostgREST truncates a plain select at 1000 rows with NO error, and this repo has shipped that bug three separate times. `.limit(n)` is NOT an escape hatch — PostgREST clamps it to max-rows, so `.limit(5000)` quietly returns 1000; use `fetchAllRows(f, { maxRows })`. Pass a FACTORY (a query builder is single-use), and give any ordered query a total sort (add `.order('id')`) or paging can skip/duplicate rows at a page boundary.
- **Volume forecast:** cold calling adds ~100 rows/day to `crm_outreach_log` team-wide. The
  `MAX_LOG_ROWS = 5000` ceiling in `src/lib/api/outreach.js` bounds the Tracker/Log table reads;
  at this rate the 30-day "All" view gets there in roughly two months, and past it the table
  silently shows a slice. Filter by type, or raise the ceiling, before it bites.
- All stage automation is **forward-only** (`advanceLeadStage`) — never regresses a lead, never touches client/passed. It deliberately skips `runStageSideEffects` to avoid double-counting.
- Reply↔pipeline sync is bidirectional: outreach marked 'replied' advances the lead to `responded`; lead dragged to responded+ flips its latest un-replied outreach entry to 'replied'.
- Leaving `meeting_booked` forward (into `warm_active` or beyond) auto-logs a 'meeting' activity — that's what the Dashboard Funnel counts as meetings. It fires on the way OUT because `meeting_booked` now means "agreed to meet," not "met."
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
- **Notifications are derived, not typed in (Sept 2026).** The bell used to watch one
  column — `crm_leads.next_follow_up_date`, scoped to `assigned_to` — so it nagged the whole
  team about ~10 rows while 158 leads that had *replied* sat untouched for over a week and 158
  engaged leads had no owner at all (every notification surface filters on `assigned_to`, so an
  unowned lead was structurally invisible). `src/lib/api/notifications.js` now derives the feed
  from state the DB already holds: promised callbacks (`crm_outreach_log.callback_at`, **time
  preserved** — a 3pm callback is not "sometime today"), demos (`crm_demos.demo_datetime`),
  scheduled follow-ups on leads **and on sellers/partners** (those columns existed since
  migrations 033/020 and nothing had ever read them), engaged leads gone quiet, and unowned
  engaged leads (admin-only).
  - Staleness is **continuous**. `getFollowUpsDue` in `today.js` still pings on
    `marks.has(daysStale)` — day 3/7/14 *exactly*, then silence forever; that exact-match is why
    179 engaged leads scored nothing. Don't copy that pattern.
  - There is **no display floor**. The old page hid anything >14 days overdue. Forgetting is now
    an explicit act — you archive the lead. If it's in the pipeline, it counts.
  - Sources run under `Promise.allSettled`: one failing source degrades that source and is
    reported in `errors`, rather than silently shortening the list.
  - The badge counts overdue + due-today only. Never count upcoming work into it.
- **Archiving leads (migration 049).** `crm_leads.is_archived` / `archived_at` /
  `archived_reason`, mirroring `people.is_archived` (029). Archived leads are out of every board,
  count, queue and notification, but **nothing is deleted** and un-archiving is one flag flip.
  Admin → "Archive old leads" is preview-first (per-stage breakdown before any write) with a
  one-click undo keyed on `archived_at`; per-lead Archive/Restore is on the lead detail page, and
  the Pipeline board has a Show/Hide Archived filter.
  - **Dedupe deliberately still sees archived leads** (`findDuplicateLead`, the import probe in
    `queue.js`). Filter them out and the next import re-creates the entire archive as new leads.
    There's a guardrail test on this — don't "fix" it.
  - Clients are never swept. `getLeads` takes `{ includeArchived }`; `/api/leads` takes
    `?include_archived=true`; `/api/analytics` excludes them unconditionally.
- **Lead health: required info + the running 30-day clock (Sept 2026, Dev's call).** Policy lives
  in `src/lib/leadHealth.js` — pure, so the flag on the lead page and the count on the scoreboard
  can never disagree. Migration 052 added `lead_channel`, `buying_timeline`, `prior_acquisitions`,
  `engagement_model`; `lead_type` and `investment_thesis` are reused.
  - **It is a FLAG, NEVER A GATE.** Dev: "it will be a basic flag if it's not all the info."
    Nothing blocks a save — not the UI, not `POST/PATCH /api/leads`. A hard gate in a shared CRM
    gets worked around and you get invented data instead of a flag (this DB already carries three
    leads with fabricated enrichment).
  - **Two tiers, and don't collapse them.** `lead_channel` + `lead_type` are required from
    `responded`; all six from `meeting_booked` (Dev's words: "a minimum amount of information once
    you're putting it in MeetingBooked"). Requiring all six from `responded` flagged **115 of 116**
    engaged leads — a flag that is always on is not a flag. Nothing is required at `outreach`.
  - **The 30-day clock is a RUNNING clock** — a rolling window from last touch that resets when the
    lead is worked, evaluated continuously. Do NOT reintroduce the `marks.has(daysStale)`
    exact-day-match pattern; that is why 179 engaged leads scored nothing. A lead with a follow-up
    scheduled today-or-later is never in breach (same rule as the archive sweep — two surfaces
    disagreeing about whether a lead is abandoned makes both untrustworthy).
  - `lead_channel` is its own column, NOT more values in `lead_source`: Dev wants a countable
    inbound-vs-outbound split ("in sales we put in 30 hours, in SEO 10"), which needs a closed
    vocabulary. Options are admin-editable via `crm_field_options` (`useFieldOptions` hook).
- **Per-person scoreboard (`src/lib/api/scoreboard.js`, `src/components/Scoreboard.jsx`).** The
  panel Om asked for: outreach done, dials, meetings booked, follow-ups set/done, plus the three
  un-windowed breach counts (stale 30d, missing info, no transcript). Lives on the Numbers tab.
  - **It REPLACED the "Today's Outreach" card**, which drew a per-person progress bar against
    `daily_outreach_target`. Those targets were deliberately zeroed Aug 2026 and *every* person in
    the DB is 0/NULL, so the card rendered an empty bar and "8 / 0" for the one person logging
    work. Targets stay supported and **fluid** (Dev) — set one and it means something; don't
    resurrect a meter that divides by zero.
  - Meetings booked comes from `crm_lead_stage_events`, which is append-only and still holds
    retired stage names (`cold_outreach` 27, `warm_lead` 2). **Map old→new when grouping by stage**
    or history silently under-counts.
  - "Follow-up done" is matched on the `Followed up…` note prefix that `logFollowUpTouch` writes —
    ugly, but it is the only marker. Do NOT count all notes: 214 of the last 416 activities were
    auto-generated "Lead created in CRM" rows, which would turn one import into a week of work.
  - Team totals sum **only the listed rows**; unattributed outreach is reported separately, never
    folded in. `dev+localtest` is filtered out of every per-person grid.
- **"Meetings" means one thing, defined in `src/lib/meetingCounts.js`** (Sept 2026, Dev: "Sage and
  CRM should not at all disagree with meetings"). They did — three numbers were in play:
  - The Monday Sage digest counted `activity_type IN ('call','meeting')` and printed the total as
    "meetings", so **a logged phone call was reported to Dev as a meeting**. Fixed: held-only.
  - That activity is auto-logged when a lead **LEAVES** `meeting_booked` (because the stage means
    "agreed to meet", not "met") — so it is a meeting **HELD**. The digest's own comment claimed it
    counted leads *entering* meeting_booked, which was wrong in both directions and is how the
    drift survived review.
  - The scoreboard counted stage events **INTO** `meeting_booked` — a meeting **BOOKED**.
  Both are worth knowing ("is work coming" vs "did work land"). The module defines `isMeetingHeld`,
  `isMeetingBooked` and `canonicalStage`; the digest and the scoreboard both import it, and
  **neither says "meetings" without saying which**. The digest prints "meetings held"; the
  scoreboard has separate Booked and Held columns. `api/` can import pure `src/lib` modules — it
  already does for `linkedin.js` and `task-tracker.js`. Guardrail: `test/meeting-counts.test.js`.
- **Transcript digest (`src/components/TranscriptDigest.jsx`)** — every call with a lead
  summarised at the top of the lead page (Om: "a summarized meeting note for all 3 transcripts in
  one place... all I'd need to jog my memory"). A pure **read** of `ai_analysis`, which
  `api/analyze-transcript.js` already computes and stores when a transcript is pasted (26 of 39 on
  file have one), so it **costs no API credits** — the credit concern applies to generating
  analysis, which stays a deliberate click. Unanalysed transcripts are listed as unanalysed, never
  skipped: a silently shorter list reads as "no call happened".
- Today tab (`src/pages/Today.jsx`): shows each person's work for that day — that's its whole job; don't redesign it into another pipeline view. Shipped July 2026 (`feature/today-tab` PR merged).
- **The left menu is data, in `src/lib/nav.js`** (Sept 2026) — pure and icon-free (names resolved
  to elements by an `ICONS` map in `Layout.jsx`) so `test/nav-shape.test.js` can pin the shape in
  the node-environment suite. Adding a tab means editing that module, and the test will tell you
  the item count changed. An analyst sees 10 items, an admin 13.
  - **`/today` is a merged workspace** (`src/pages/TodayWorkspace.jsx`): Today + Notifications +
    Numbers (Dashboard) as sub-tabs under ONE menu entry, using the app's `.tabs`/`.tab` pattern.
    It is a shell — each sub-tab mounts the existing page component untouched, and only the
    active one is mounted, so the page does not fetch three times. They were three answers to
    "what should I do today" and overlapped in their reads (Today + Dashboard both call
    `getMovementWeekOverWeek`; Dashboard + Analytics both call `getOutreachStatsByPerson`).
  - The overdue badge moved to the **Today** nav entry. Don't add a second one to the
    Notifications sub-tab — it would duplicate a number already on screen and cost a second
    `useNotificationCount`, which derives the whole feed on mount/focus/change/5-min poll.
  - **`/notifications`, `/dashboard` and `/outreach-queue` are still live routes.** Losing a tab
    never means losing a page here — deep links, bookmarks and the command palette keep working,
    and restoring a tab is one line in `nav.js`. There's a guardrail test on this.
- Dev's standing product decisions: all five contact tables stay (leads, sellers, investors,
  partners, demos) — July 2026, unchanged. Tracker/Queue/Log remain three separate **pages**
  (July 2026), but **Sept 2026 (Dev's call) removed Queue's top-level tab and made Log
  admin-only**: `getOutreachQueue` ("my leads at stage outreach with no outreach_log row at all",
  grouped by import batch) is a subset of Today's queue and Cold Calls has its own Queue sub-tab;
  Log reads team-wide history and self-scopes to the one person for a non-admin, making it a
  weaker Tracker. Queue's unique affordance was the import-batch grouping — that's what an
  analyst gives up.

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
