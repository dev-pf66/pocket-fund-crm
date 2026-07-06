# Pocket Fund CRM — Product Audit

*July 2026. Four parallel code audits (outreach pages, contact entities, metrics surfaces, peripheral pages) synthesized into one assessment.*

## What this app is for

One core loop: **get a list → contact people → get replies → book meetings → convert.**
Two personas: **analysts** (daily volume outreach, 10/day goal) and the **founder/admin** (pipeline health, conversion, accountability; plus PE OS demo sales, partners, LPs).

Everything in the app should either serve that loop or be deliberately ancillary. Today it doesn't cleanly do either.

## What we have — 13 sidebar items, 3 flows

| Flow | Surfaces |
|---|---|
| Lead outreach (core) | Dashboard, Pipeline, Tracker, Queue, Log, Goals, Analytics — **7 surfaces for 1 loop** |
| PE OS demo sales | PE OS board (well designed, self-contained) |
| Founder-side | Partners (isolated), Investors (isolated) |
| Support | Import (solid), Admin (solid), Templates (dead-end), Sample Deals (unclear usage), Help (rot risk) |

## The three structural problems

### 1. One loop, seven surfaces

The three outreach pages (Tracker / Queue / Log) share ~70% of their features: all three can show your log, two can edit entries, two can log outreach (by different flows), stats/streaks appear on two of them plus Dashboard plus Analytics. A new analyst can't tell where to log an outreach. The metric audit found the same number (today count, streak, weekly count, reply rate) rendered on up to four pages — currently consistent only because the math was recently extracted into one lib.

**Worst single finding: the Goals page is fully manual.** An analyst who logs 52 outreaches still shows 0/50 on their "50 outreaches/week" goal unless they tap + fifty-two times. Nobody will do that; the page is effectively dead weight as built.

### 2. Five contact tables that don't know each other

`crm_leads`, `crm_investors`, `crm_partners`, `crm_demos` contact fields, and orphaned `crm_outreach_log` rows (nullable `lead_id`) each hold people, with almost no cross-links:

- Outreach logged without a lead link breaks conversion attribution — the funnel can't trace outreach → reply → meeting for the same human.
- A demo requires a lead, so LPs/partners get duplicated into leads to be demoed.
- Dedup exists only at two entry points (LinkedIn bulk add, outreach promote); everywhere else duplicates are silent.
- LeadDetail — supposedly the hub for one person — shows **neither their outreach history nor their demos.**

### 3. Collection gaps that undermine the numbers

- **Meetings** only count if someone logs them (quick-log button or a demo entry). No logging norm → conversion reads low.
- **No source quality**: reply rate isn't sliceable by lead source, so list-buying decisions are blind.
- **Missing sales-org metrics**: time-to-first-touch, follow-up compliance (% of leads with a 2nd touch), conversion velocity, touches-per-lead distribution.
- **Templates aren't in the flow**: copy-paste-only library, unreachable from where outreach actually happens → unused → message quality untracked.

## Target state

**Navigation: 13 items → ~8.**

```
Dashboard        (analyst scoreboard + admin funnel — shipped July 2026)
Outreach         (ONE hub: Queue tab · Log-entry tab · History/Review tab)
Pipeline         (kanban + LeadDetail as the true person-hub)
PE OS            (as-is, plus lead↔demo backlinks)
Analytics        (admin deep-dive; absorb what's unique from the Log dashboard)
Admin            (as-is)
— founder-only: Partners, Investors
```

- **Merge Tracker + Queue + Log** into one Outreach page with three tabs. Queue's batch worklist, Tracker's quick-log/CSV ergonomics, and Log's review/admin depth all survive; the duplicate "view my log" / "edit entry" / stats implementations don't. Roughly 40% less code, one obvious place to work.
- **Goals**: auto-sync outreach-type goals from the actual log (the data is already there), then fold the page into the Dashboard's My Week block. Manual goals only if someone actually wants habit tracking.
- **Contacts**: don't big-bang a unified `crm_contacts` table now. Incremental spine instead: (a) dedup check at *every* creation point, (b) auto-promote orphaned outreach to a lead at creation time, (c) backfill existing orphans, (d) optional `lead_id` on investors/partners, (e) Outreach-history + Demos cards on LeadDetail. Revisit one-table unification only if the team grows.
- **Templates**: either a "Use template" action inside the outreach log-entry flow (variables auto-filled from the lead) or cut the page.
- **Data collection norms**: every meeting gets logged (one-line team rule); add `lead_source` reply-rate slice to Analytics; add time-to-first-touch + follow-up compliance once orphan-linking is fixed (they're uncomputable while outreach is unattributed).

## Roadmap

| Phase | What | Why first |
|---|---|---|
| 1 | LeadDetail gains Outreach History + Demos cards; Goals auto-sync from outreach log | Highest value-to-risk; fixes the hub and un-deadens Goals without moving anything |
| 2 | Merge the three outreach pages into one hub; delete duplicated dashboards | Biggest UX + code-size win; do as one focused project |
| 3 | Contact spine: creation-time dedup everywhere, auto-promote orphans, backfill, source-quality + first-touch metrics in Analytics | Makes the funnel numbers trustworthy |
| 4 | Decide Templates (integrate/cut), Sample Deals (clarify), Investors (active or legacy?), Help (maintenance policy or external doc) | Founder decisions, low urgency |

## Open decisions (founder)

1. **Merge the outreach pages?** Biggest workflow change for the team — needs your yes.
2. **Investors + Sample Deals** — actively used, or legacy to archive?
3. **Templates** — worth an in-flow composer, or cut?

## Per-page verdicts (from the audits)

| Page | Verdict |
|---|---|
| Dashboard | Keep — recently rebuilt (My Week + Funnel) |
| Pipeline / LeadDetail | Keep — add outreach + demo history cards (hub gap) |
| Tracker / Queue / Log | Merge into one Outreach hub |
| PE OS | Keep — add lead↔demo backlinks |
| Goals | Auto-sync then fold into Dashboard |
| Analytics | Keep (admin) — absorb Log's unique charts; add source quality |
| Import | Keep — solid (dedup added July 2026) |
| Admin | Keep — backbone |
| Partners | Keep — founder tool, working |
| Investors | Founder to confirm active use |
| Templates | Integrate into log flow or cut |
| Sample Deals | Founder to confirm active use |
| Help / HelpAdmin | Keep only with a maintenance policy |
