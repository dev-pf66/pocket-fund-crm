/**
 * CRM API — the notification feed.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * Notifications used to watch exactly one column: crm_leads.next_follow_up_date,
 * scoped to assigned_to = you. On 2026-09-26 that meant the bell nagged the
 * whole team about 10 rows — while 158 leads that had REPLIED to us sat
 * untouched for more than a week, and 158 engaged leads had no owner at all
 * (so no owner-scoped surface could ever mention them).
 *
 * The bell wasn't broken. It was watching a field almost nobody fills in.
 *
 * So the feed is now DERIVED from state the database already holds, and a
 * scheduled date is one signal among several rather than the only one:
 *
 *   callback       crm_outreach_log.callback_at   a promised time, with the time kept
 *   demo           crm_demos.demo_datetime        it's on the calendar
 *   followup       crm_leads.next_follow_up_date  the explicit promise
 *   seller_followup / partner_followup            same, on tables nothing read
 *   went_quiet     engaged + past threshold       the 186 nobody was told about
 *   unowned        engaged + assigned_to null     nobody can work what nobody owns
 *
 * TWO RULES THAT THE OLD VERSION GOT WRONG
 * ----------------------------------------
 * 1. Staleness is CONTINUOUS, not an exact-day match. getFollowUpsDue in
 *    today.js pings on `marks.has(daysStale)` — day 3, day 7, day 14 exactly,
 *    and then silence forever. A lead quiet for 40 days scored nothing. Here,
 *    past the threshold means past it, and the rank climbs with the silence.
 *
 * 2. Nothing is hidden by an arbitrary display floor. The old page dropped
 *    anything more than 14 days overdue so an ancient miss wouldn't dominate —
 *    which is amnesia dressed as tidiness. Forgetting is now an explicit act:
 *    you archive the lead (see ./archive). If it's still in the pipeline, it
 *    still counts.
 *
 * Archived leads never produce a signal, anywhere in this file.
 */

import { supabase } from '../supabase'
import { istToday, istAddDays } from '../dateUtils'
import { fetchAllRows, getDaysBetween } from './core'
import { getCallbacksDue } from './calls'
import { getTodayThresholds } from './today'

const TERMINAL_LEAD_STAGES = ['client', 'passed']
const ENGAGED_STAGES = ['responded', 'meeting_booked', 'warm_active']

/** How far ahead "coming up" looks. */
export const UPCOMING_DAYS = 14

/**
 * Base weight per signal kind — what this thing is worth before we look at
 * how late it is. A promised callback time outranks everything because it's
 * the one contact who already agreed to talk; a lead merely going quiet is
 * real but cheap to act on late.
 */
const KIND_WEIGHT = {
  callback: 100,
  demo: 90,
  followup: 70,
  seller_followup: 65,
  partner_followup: 50,
  went_quiet: 40,
  unowned: 35
}

/** Urgency multiplies the base weight. */
const URGENCY_WEIGHT = { overdue: 3, today: 2.5, soon: 1.2, upcoming: 0.5 }

/** Bucket a date against today. */
function urgencyFor(dateStr, today) {
  if (!dateStr) return 'upcoming'
  const d = String(dateStr).slice(0, 10)
  if (d < today) return 'overdue'
  if (d === today) return 'today'
  return d <= istAddDays(today, 3) ? 'soon' : 'upcoming'
}

/**
 * Final ordering score. Lateness is logarithmic-ish (capped at 30 days of
 * bonus) so a 6-month-old miss doesn't permanently outrank today's callback —
 * the point is to surface what to do now, not to rank grievances.
 */
function scoreOf({ kind, urgency, daysLate = 0, leadScore = 0 }) {
  const base = KIND_WEIGHT[kind] ?? 10
  const late = Math.min(Math.max(daysLate, 0), 30)
  return base * (URGENCY_WEIGHT[urgency] ?? 1) + late * 2 + Math.min(leadScore, 100) / 10
}

function daysLateFrom(dateStr, today) {
  if (!dateStr) return 0
  const d = String(dateStr).slice(0, 10)
  return d < today ? getDaysBetween(new Date(d + 'T00:00:00Z'), new Date(today + 'T00:00:00Z')) : 0
}

/** "in 2h" / "3 days late" / "today" — one phrasing for every row. */
function describeTiming(dateStr, today) {
  const u = urgencyFor(dateStr, today)
  if (u === 'today') return 'due today'
  if (u === 'overdue') {
    const n = daysLateFrom(dateStr, today)
    return n === 1 ? '1 day late' : `${n} days late`
  }
  const n = getDaysBetween(new Date(today + 'T00:00:00Z'), new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z'))
  return n === 1 ? 'tomorrow' : `in ${n} days`
}

// ============================================================================
// SIGNAL SOURCES
// ============================================================================
// Each returns a flat array of feed items. They're independent on purpose —
// one source failing shouldn't blank the page (see getNotificationFeed).

/** Scheduled reach-outs on leads: the original signal, minus the 14-day floor. */
async function leadFollowUps(personId, today) {
  const horizon = istAddDays(today, UPCOMING_DAYS)
  const rows = await fetchAllRows(() => {
    let q = supabase
      .from('crm_leads')
      .select('id, name, firm_name, stage, assigned_to, lead_score, linkedin_url, next_follow_up_date, follow_up_note, follow_up_cadence')
      .eq('is_archived', false)
      .not('next_follow_up_date', 'is', null)
      .lte('next_follow_up_date', horizon)
      .not('stage', 'in', `(${TERMINAL_LEAD_STAGES.join(',')})`)
      .order('next_follow_up_date')
      .order('id')
    if (personId) q = q.eq('assigned_to', personId)
    return q
  })

  return rows.map(l => {
    const urgency = urgencyFor(l.next_follow_up_date, today)
    const daysLate = daysLateFrom(l.next_follow_up_date, today)
    const cadence = l.follow_up_cadence
    return {
      id: `followup:${l.id}`,
      kind: 'followup',
      urgency,
      dueDate: l.next_follow_up_date,
      title: l.name || 'Unknown',
      subtitle: l.firm_name || null,
      detail: l.follow_up_note || null,
      meta: cadence?.offsets?.length
        ? `${cadence.name} ${Math.min(cadence.step, cadence.offsets.length)}/${cadence.offsets.length}`
        : null,
      timing: describeTiming(l.next_follow_up_date, today),
      stage: l.stage,
      leadId: l.id,
      ownerId: l.assigned_to,
      href: `/leads/${l.id}`,
      linkedinUrl: l.linkedin_url,
      lead: l,
      actionable: true,
      score: scoreOf({ kind: 'followup', urgency, daysLate, leadScore: l.lead_score })
    }
  })
}

/**
 * Engaged leads that have gone quiet past their stage threshold — continuous,
 * so day 15 and day 50 both count. Excludes anything with a scheduled
 * follow-up: that lead is already represented by its `followup` item and two
 * rows for one lead is how a feed starts feeling like noise.
 */
async function wentQuiet(personId, today, thresholds) {
  const rows = await fetchAllRows(() => {
    let q = supabase
      .from('crm_leads')
      .select('id, name, firm_name, stage, assigned_to, lead_score, linkedin_url, last_activity_date, created_at, next_follow_up_date')
      .eq('is_archived', false)
      .in('stage', ENGAGED_STAGES)
      .is('next_follow_up_date', null)
      .order('id')
    if (personId) q = q.eq('assigned_to', personId)
    return q
  })

  const limitFor = {
    responded: thresholds.warm,
    meeting_booked: thresholds.active,
    warm_active: thresholds.active
  }

  const out = []
  for (const l of rows) {
    // Unowned leads are their own signal (and would otherwise be invisible
    // here anyway whenever personId is set).
    if (!l.assigned_to) continue
    const ref = l.last_activity_date || l.created_at
    if (!ref) continue
    const quiet = getDaysBetween(new Date(ref), new Date())
    const limit = limitFor[l.stage] ?? thresholds.active
    if (quiet <= limit) continue

    out.push({
      id: `quiet:${l.id}`,
      kind: 'went_quiet',
      urgency: quiet > limit * 2 ? 'overdue' : 'today',
      dueDate: null,
      title: l.name || 'Unknown',
      subtitle: l.firm_name || null,
      detail: l.stage === 'responded'
        ? 'They replied and nobody has been back to them'
        : 'Engaged, then silence',
      meta: null,
      timing: `quiet ${quiet} days`,
      stage: l.stage,
      leadId: l.id,
      ownerId: l.assigned_to,
      href: `/leads/${l.id}`,
      linkedinUrl: l.linkedin_url,
      lead: l,
      actionable: true,
      quietDays: quiet,
      score: scoreOf({
        kind: 'went_quiet',
        urgency: quiet > limit * 2 ? 'overdue' : 'today',
        daysLate: quiet - limit,
        leadScore: l.lead_score
      })
    })
  }
  return out
}

/**
 * Engaged leads with no owner. Admin-only, because it isn't any one rep's
 * problem to solve and putting it in everyone's bell would just be noise
 * seven times over. This is the biggest hole the audit found: every
 * notification surface filters on assigned_to, so an unowned lead is
 * structurally invisible until someone claims it.
 */
async function unownedEngaged() {
  const rows = await fetchAllRows(() => supabase
    .from('crm_leads')
    .select('id, name, firm_name, stage, lead_score, linkedin_url, last_activity_date, created_at')
    .eq('is_archived', false)
    .in('stage', ENGAGED_STAGES)
    .is('assigned_to', null)
    .order('id'))

  return rows.map(l => {
    const ref = l.last_activity_date || l.created_at
    const quiet = ref ? getDaysBetween(new Date(ref), new Date()) : 0
    return {
      id: `unowned:${l.id}`,
      kind: 'unowned',
      urgency: 'today',
      dueDate: null,
      title: l.name || 'Unknown',
      subtitle: l.firm_name || null,
      detail: 'Engaged but unassigned — nobody is being told about this one',
      meta: null,
      timing: quiet ? `quiet ${quiet} days` : 'unassigned',
      stage: l.stage,
      leadId: l.id,
      ownerId: null,
      href: `/leads/${l.id}`,
      linkedinUrl: l.linkedin_url,
      lead: l,
      actionable: false,
      quietDays: quiet,
      score: scoreOf({ kind: 'unowned', urgency: 'today', daysLate: quiet, leadScore: l.lead_score })
    }
  })
}

/**
 * Callbacks promised on a cold call. These carry a TIME, and the time is the
 * whole point — "callback at 15:00" and "follow up sometime today" are not the
 * same commitment, but the lead-level date column flattens them into one.
 * Reuses getCallbacksDue so "spent" callbacks (we've dialled since) and
 * do-not-call leads are excluded by the same logic Call Mode uses.
 */
async function callbacks(personId, today) {
  const rows = await getCallbacksDue(personId, { includeUpcoming: true })
  const now = Date.now()
  const horizonMs = now + UPCOMING_DAYS * 86400000

  return rows
    .filter(r => r.callback_at && new Date(r.callback_at).getTime() <= horizonMs)
    .map(r => {
      const at = new Date(r.callback_at)
      const dateStr = r.callback_at.slice(0, 10)
      const overdue = at.getTime() <= now
      const urgency = overdue ? 'overdue' : urgencyFor(dateStr, today)
      const time = at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
      return {
        id: `callback:${r.id}`,
        kind: 'callback',
        urgency,
        dueDate: dateStr,
        dueAt: r.callback_at,
        title: r.lead?.name || 'Unknown',
        subtitle: r.lead?.firm_name || null,
        detail: r.notes || 'Asked for a call back',
        meta: r.lead?.phone || null,
        // The one place a time is more use than a date.
        timing: overdue ? `callback was ${time}` : `callback ${describeTiming(dateStr, today)} at ${time}`,
        stage: r.lead?.stage,
        leadId: r.lead_id,
        ownerId: r.logged_by,
        href: r.lead_id ? `/leads/${r.lead_id}` : '/cold-calls',
        lead: r.lead || null,
        actionable: false,
        score: scoreOf({ kind: 'callback', urgency, daysLate: daysLateFrom(dateStr, today) })
      }
    })
}

/** Demos on the calendar. Scheduled only — a done demo isn't a notification. */
async function demos(personId, today) {
  const horizon = istAddDays(today, UPCOMING_DAYS)
  const rows = await fetchAllRows(() => {
    let q = supabase
      .from('crm_demos')
      .select('id, lead_id, stage, demo_date, demo_datetime, next_steps, created_by, lead:crm_leads(id, name, firm_name, stage, is_archived)')
      .eq('stage', 'scheduled')
      .order('id')
    if (personId) q = q.eq('created_by', personId)
    return q
  })

  return rows
    .filter(d => !d.lead?.is_archived)
    .map(d => {
      const dateStr = (d.demo_datetime || d.demo_date || '').slice(0, 10)
      if (!dateStr || dateStr > horizon) return null
      const urgency = urgencyFor(dateStr, today)
      const time = d.demo_datetime
        ? new Date(d.demo_datetime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
        : null
      return {
        id: `demo:${d.id}`,
        kind: 'demo',
        urgency,
        dueDate: dateStr,
        dueAt: d.demo_datetime || null,
        title: d.lead?.name || 'Demo',
        subtitle: d.lead?.firm_name || null,
        detail: d.next_steps || 'Demo on the calendar',
        meta: null,
        timing: `demo ${describeTiming(dateStr, today)}${time ? ` at ${time}` : ''}`,
        stage: d.lead?.stage,
        leadId: d.lead_id,
        ownerId: d.created_by,
        href: '/pe-os',
        lead: d.lead || null,
        actionable: false,
        score: scoreOf({ kind: 'demo', urgency, daysLate: daysLateFrom(dateStr, today) })
      }
    })
    .filter(Boolean)
}

/**
 * Scheduled follow-ups on sellers and partners. Both tables have carried a
 * next_follow_up_date column since migrations 033 and 020 and NOTHING has
 * ever read them — schedule a seller follow-up today and it notifies no one.
 */
async function otherPipelineFollowUps(personId, today) {
  const horizon = istAddDays(today, UPCOMING_DAYS)

  const [sellers, partners] = await Promise.all([
    fetchAllRows(() => {
      let q = supabase
        .from('crm_sellers')
        .select('id, name, business_name, stage, assigned_to, created_by, next_follow_up_date, notes')
        .not('next_follow_up_date', 'is', null)
        .lte('next_follow_up_date', horizon)
        .not('stage', 'in', '(acquired,passed)')
        .order('id')
      // Sellers are a shared book, but a rep's bell should still be theirs.
      if (personId) q = q.or(`assigned_to.eq.${personId},created_by.eq.${personId}`)
      return q
    }),
    fetchAllRows(() => {
      let q = supabase
        .from('crm_partners')
        .select('id, name, stage, created_by, next_follow_up_date, notes')
        .not('next_follow_up_date', 'is', null)
        .lte('next_follow_up_date', horizon)
        .not('stage', 'in', '(active_partner,passed)')
        .order('id')
      // crm_partners has no assigned_to — created_by is the only owner it has.
      if (personId) q = q.eq('created_by', personId)
      return q
    })
  ])

  const sellerItems = sellers.map(s => {
    const urgency = urgencyFor(s.next_follow_up_date, today)
    return {
      id: `seller:${s.id}`,
      kind: 'seller_followup',
      urgency,
      dueDate: s.next_follow_up_date,
      title: s.name || 'Seller',
      subtitle: s.business_name || null,
      detail: s.notes ? String(s.notes).slice(0, 120) : 'Seller follow-up',
      meta: null,
      timing: describeTiming(s.next_follow_up_date, today),
      stage: s.stage,
      leadId: null,
      ownerId: s.assigned_to || s.created_by,
      href: '/sellers',
      lead: null,
      actionable: false,
      score: scoreOf({ kind: 'seller_followup', urgency, daysLate: daysLateFrom(s.next_follow_up_date, today) })
    }
  })

  const partnerItems = partners.map(p => {
    const urgency = urgencyFor(p.next_follow_up_date, today)
    return {
      id: `partner:${p.id}`,
      kind: 'partner_followup',
      urgency,
      dueDate: p.next_follow_up_date,
      title: p.name || 'Partner',
      subtitle: null,
      detail: p.notes ? String(p.notes).slice(0, 120) : 'Partner follow-up',
      meta: null,
      timing: describeTiming(p.next_follow_up_date, today),
      stage: p.stage,
      leadId: null,
      ownerId: p.created_by,
      href: '/partners',
      lead: null,
      actionable: false,
      score: scoreOf({ kind: 'partner_followup', urgency, daysLate: daysLateFrom(p.next_follow_up_date, today) })
    }
  })

  return [...sellerItems, ...partnerItems]
}

// ============================================================================
// THE FEED
// ============================================================================

export const NOTIFICATION_KINDS = Object.keys(KIND_WEIGHT)

/**
 * Everything that wants this person's attention, ranked.
 *
 * personId null aggregates across every owner (the admin "all owners" view).
 * `isAdmin` additionally unlocks the unowned-lead signal, which is a
 * team-level problem rather than any one rep's.
 *
 * Sources are gathered with allSettled: a broken table or a permissions edge
 * on ONE signal degrades that signal, it doesn't blank the page. Whatever
 * failed comes back in `errors` so the UI can say so rather than quietly
 * showing a shorter list — a notification page that under-reports without
 * saying so is worse than one that's down.
 */
export async function getNotificationFeed(personId = null, { isAdmin = false, limit = 100 } = {}) {
  const today = istToday()
  const thresholds = await getTodayThresholds()

  const sources = [
    ['followup', leadFollowUps(personId, today)],
    ['callback', callbacks(personId, today)],
    ['demo', demos(personId, today)],
    ['went_quiet', wentQuiet(personId, today, thresholds)],
    ['other', otherPipelineFollowUps(personId, today)]
  ]
  if (isAdmin) sources.push(['unowned', unownedEngaged()])

  const settled = await Promise.allSettled(sources.map(([, p]) => p))

  const items = []
  const errors = []
  settled.forEach((r, i) => {
    const name = sources[i][0]
    if (r.status === 'fulfilled') items.push(...r.value)
    else {
      console.error(`Notification source "${name}" failed:`, r.reason)
      errors.push({ source: name, message: r.reason?.message || String(r.reason) })
    }
  })

  items.sort((a, b) => b.score - a.score || String(a.dueDate).localeCompare(String(b.dueDate)))

  const counts = {
    total: items.length,
    overdue: items.filter(i => i.urgency === 'overdue').length,
    today: items.filter(i => i.urgency === 'today').length,
    soon: items.filter(i => i.urgency === 'soon').length,
    upcoming: items.filter(i => i.urgency === 'upcoming').length,
    byKind: items.reduce((acc, i) => { acc[i.kind] = (acc[i.kind] || 0) + 1; return acc }, {})
  }

  return { items: items.slice(0, limit), counts, errors, truncated: items.length > limit, today }
}

/**
 * Just the numbers behind the sidebar badge.
 *
 * The badge counts what needs you NOW — overdue plus due today — and
 * deliberately not the upcoming ones: a bell that counts things you can't act
 * on yet is a bell people learn to ignore.
 */
export async function getNotificationCounts(personId = null, { isAdmin = false } = {}) {
  const { counts, errors } = await getNotificationFeed(personId, { isAdmin, limit: 0 })
  return {
    total: counts.overdue + counts.today,
    overdue: counts.overdue,
    dueToday: counts.today,
    byKind: counts.byKind,
    degraded: errors.length > 0
  }
}
