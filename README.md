# Pocket Fund Sales CRM

**The system of record for every person Pocket Fund is in a commercial conversation with.**
If a relationship isn't in here, it doesn't exist — the same rule the Sage task tracker has for work.

Live at <https://pocket-fund-crm.vercel.app>. React SPA + Vercel serverless functions + Supabase.

## What it's for

One loop, run every working day:

**build a list → contact people → get replies → book meetings → convert.**

Two jobs sit on top of that loop, and every screen in the app serves one of them:

| Who | What they need from it |
|---|---|
| **Analysts** (Aum, Gaurav, Pushkar and the outreach team) | "Who do I contact today, and did I hit my number?" — a daily working queue, somewhere to log every touch, and an honest count against their target. |
| **Dev (founder/admin)** | "Is the pipeline healthy, who is slipping, and what is waiting on me?" — conversion, accountability, and the escalations only he can clear. |

It is deliberately **not** a general database, and deliberately **not** in the wiki. The wiki holds
thinking; this holds people and what we owe them.

## The five contact books

Five separate tables on purpose — they are different relationships with different pipelines, and
merging them would destroy the funnel maths. (Standing product decision, July 2026: all five stay.)

| Table | Who's in it | Pipeline |
|---|---|---|
| `crm_leads` | **Buyers** — the core sales funnel | outreach → responded → meeting_booked → warm_active → client (`passed` is terminal) |
| `crm_sellers` | Indian business owners Kautilya might **acquire** — buyside, kept out of the sales funnel entirely | sourced → contacted → intro_call → evaluating → loi_offer → acquired/passed |
| `crm_investors` | LPs and the shared contact book | — (open to the whole team by design) |
| `crm_partners` | Creators, communities, funds, podcasts, media | potential → reached_out → in_conversation → active_partner/passed |
| `crm_demos` | PE OS product demos, each linked to a lead | scheduled → done → signed_up/passed |

Supporting tables: `crm_outreach_log` (one row per touch — LinkedIn, email **and every cold-call
dial**), `crm_lead_activities` (calls, meetings, notes), `people` (the team).

## The daily surfaces

| Page | The question it answers |
|---|---|
| **Today** | What is my work, today? Don't turn this into another pipeline view. |
| **Notifications** | What have I promised, what has slipped, what is about to? Derived from real state — see `CLAUDE.md`. |
| **Dashboard** | Am I hitting my number? (analyst) / How is the funnel? (admin) |
| **Tracker / Queue / Log** | Log a touch, work an imported list, audit what was logged. Three pages on purpose — standing decision, July 2026. |
| **Cold Calls** | The dial list, outcomes, and the call funnel. A gatekeeper is a pickup, **not** a conversation. |
| **Pipeline / Sellers / Investors / Partners / PE OS** | The five contact books above. |
| **Analytics** | Conversion and source quality. |
| **Admin** | Users, targets, field options, and the lead archive sweep. |

## Two rules worth knowing before you change anything

- **Dials count, conversations are what we manage on.** Every cold-call dial is a row in
  `crm_outreach_log`, so it counts toward the daily target for free — but the outcome vocabulary
  (`src/lib/callOutcomes.js`) keeps pickups, conversations and meetings strictly separate.
  Folding them together flatters the funnel by exactly the amount that matters.
- **Nothing is ever deleted.** Leads leave the working surfaces by being *archived*
  (`is_archived`), never removed — the row, its activities and its calls all stay, and archived
  leads still block duplicate imports.

## Running it

```bash
npm install
npm run dev          # SPA only — api/* needs `vercel dev`
```

`.env` (gitignored) needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, unquoted.
Server-side env comes from `vercel env pull .env.local`.

Checks — all three run on every PR to main, and CI is the only gate before production:

```bash
npm run lint         # 0 errors (warnings remain)
npm test             # vitest — guardrails, not coverage
npm run build
```

Schema changes go in `migrations/` and are applied with the Supabase CLI — see
[`migrations/README.md`](migrations/README.md).

## Deploy

Vercel deploys from `origin/main`, automatically, with no gate of its own. A push is not a deploy
and a deploy is not a verified fix — verify the live site before claiming anything is live.

> Both this app and the task tracker return their **SPA shell with HTTP 200 for unknown API
> routes**. A 200 proves nothing: a JSON body means the endpoint is real, HTML means it isn't.

## Where to look next

| | |
|---|---|
| `CLAUDE.md` | The traps. Read this before changing pipeline machinery, notifications, pagination or the archive. |
| `api/README.md` | Full HTTP API reference — the preferred way to read/write CRM data from outside the app. |
| `migrations/README.md` | How to apply a schema change, and how to actually check whether one landed. |
| `docs/PRODUCT-AUDIT.md` | July 2026 audit. Some recommendations were explicitly rejected — `CLAUDE.md` says which. |
| In-app **Help** | Team-facing guides, stored in `crm_help_articles` and edited from Help Admin. |
