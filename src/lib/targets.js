/**
 * Per-person outreach targets.
 *
 * Pure and page-free on purpose. These lived in `pages/Dashboard.jsx`, which
 * meant ColdCalls and OutreachTracker imported logic from a page component, and
 * meant none of it could be tested in the node-environment suite — importing
 * Dashboard drags in App → Layout → the whole component tree. That is precisely
 * how three separate phantom quotas survived unnoticed.
 *
 * THE DEFAULT IS 0, AND 0 MEANS "NO TARGET" — not "a target of zero".
 * Targets were deliberately zeroed in Aug 2026: sales moved to a low-volume,
 * high-targeting motion, so holding everyone to a daily send quota measured the
 * wrong thing (Dev's call). Every meter that divides by a target must therefore
 * check `hasTarget` first and render nothing rather than a bar against 0 — a
 * "/ 0" denominator is what the Dashboard shipped for months.
 *
 * Targets stay **fluid** (Dev, Sept 2026): set one in Admin → All Users →
 * Targets and every meter starts meaning something again. Never reintroduce a
 * non-zero default; that is a quota nobody agreed to.
 */

export const DEFAULT_DAILY_TARGET = 0
export const DEFAULT_WEEKLY_TARGET = 0

/** `??` not `||`, so an explicit 0 survives as a deliberate "no target". */
export const dailyTargetOf = (person) => person?.daily_outreach_target ?? DEFAULT_DAILY_TARGET
export const weeklyTargetOf = (person) => person?.weekly_outreach_target ?? DEFAULT_WEEKLY_TARGET

/**
 * Does this person have a real quota to be measured against?
 *
 * TAKES A NUMBER, NOT A PERSON. `hasTarget(person)` gives `Number({...})` =
 * NaN, NaN > 0 = false — so it silently answers "no target" for everyone,
 * forever. ColdCalls did exactly that; it was invisible while every target was 0
 * and would have been wrong the moment one was set.
 */
export const hasTarget = (t) => Number(t) > 0
