/**
 * CRM API — outreach: log CRUD, reply→pipeline sync, orphan promotion,
 * per-person dashboard stats, weekly funnel, outreach analytics.
 */

import { supabase } from '../supabase'
import { normalizeLinkedInUrl } from '../linkedin'
import { istAddDays, istWeekStart } from '../dateUtils'
import { cacheClear, fireTTEvent, istDateStr, fetchAllRows } from './core'
import { advanceLeadStage, createLead, findLeadByEmailOrNameFirm } from './leads'
import { logActivityManual } from './misc'

// Explicit ceiling for the two "give me the whole log" readers below. Both
// feed a scrollable table that Analytics also re-aggregates, so they want a
// generous bound rather than every row ever — but left unbounded they were
// silently getting PostgREST's 1000-row max-rows instead of a number we chose,
// and Analytics was aggregating that truncated slice. This is a cap we picked.
const MAX_LOG_ROWS = 5000

// ============================================================================
// OUTREACH TRACKER
// ============================================================================

/**
 * Get outreach log entries
 */
export async function getOutreachLog(filters = {}, personId = null) {
  // Built inside the factory: fetchAllRows calls it once per page and a
  // Supabase query builder is single-use.
  const build = () => {
    let query = supabase
      .from('crm_outreach_log')
      .select(`
        *,
        lead:crm_leads(id, name, firm_name, stage, outreach_stage),
        logged_by_person:logged_by(id, name)
      `)
      .order('outreach_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })

    if (filters.outreach_date) {
      query = query.eq('outreach_date', filters.outreach_date)
    }

    if (filters.outreach_type) {
      query = query.eq('outreach_type', filters.outreach_type)
    }

    if (filters.status) {
      query = query.eq('status', filters.status)
    }

    if (filters.days_back) {
      query = query
        .gte('outreach_date', istAddDays(istDateStr(), -filters.days_back))
        .lte('outreach_date', istDateStr())
    }

    if (personId) query = query.eq('logged_by', personId)
    return query
  }

  return fetchAllRows(build, { maxRows: MAX_LOG_ROWS })
}

/**
 * Log an outreach activity
 */
export async function logOutreach(outreachData, currentPersonId, currentPersonName) {
  const { data, error } = await supabase
    .from('crm_outreach_log')
    .insert([{
      ...outreachData,
      logged_by: currentPersonId,
      outreach_date: outreachData.outreach_date || istDateStr()
    }])
    .select()
    .single()

  if (error) throw error

  // Log activity
  if (currentPersonName && data) {
    const typeLabel = outreachData.outreach_type?.replace(/_/g, ' ') || 'outreach'
    const description = `${currentPersonName} logged ${typeLabel} to ${outreachData.lead_name}${outreachData.firm_name ? ' at ' + outreachData.firm_name : ''}`

    try {
      await logActivityManual({
        user_id: currentPersonId,
        user_name: currentPersonName,
        action_type: 'outreach_logged',
        description,
        entity_type: 'outreach',
        entity_id: data.id,
        entity_name: outreachData.lead_name,
        metadata: {
          outreach_type: outreachData.outreach_type,
          firm: outreachData.firm_name,
          fit_score: outreachData.fit_score
        }
      })
    } catch (activityError) {
      console.error('Failed to log activity:', activityError)
    }
  }

  // /api/events/fire treats the payload AS the outreach row
  // (it does `onOutreachLogged({ outreach: payload })`), so send
  // the raw row — wrapping it would double-nest and the dispatcher
  // would silently bail out with missing_fields.
  fireTTEvent('outreach_logged', data)

  // An entry logged as already-replied belongs in the pipeline too.
  if (data.status === 'replied') {
    await syncReplyToPipeline(data, currentPersonId)
  }

  return data
}

/**
 * Bulk-insert multiple outreach entries in a single DB round-trip.
 * Used by the CSV uploader — avoids N sequential inserts (slow, fragile).
 * Returns the number of rows actually inserted.
 */
export async function logOutreachBatch(rows, currentPersonId) {
  if (!rows || rows.length === 0) return 0
  const today = istDateStr()
  const records = rows.map(r => ({
    ...r,
    logged_by: currentPersonId,
    outreach_date: r.outreach_date || today,
  }))

  // Attribution: link rows to existing leads before insert (one candidate
  // fetch + client-side match, instead of N lookups). Unmatched rows stay
  // orphans — we don't mass-create leads from a CSV of sent outreach.
  try {
    const { data: candidates } = await supabase
      .from('crm_leads')
      .select('id, name, firm_name, email, linkedin_url')
    if (candidates?.length) {
      const byLinkedIn = new Map()
      const byEmail = new Map()
      const byNameFirm = new Map()
      for (const l of candidates) {
        if (l.linkedin_url) byLinkedIn.set(normalizeLinkedInUrl(l.linkedin_url), l.id)
        if (l.email) byEmail.set(l.email.toLowerCase(), l.id)
        if (l.name) byNameFirm.set(`${l.name.toLowerCase()}|${(l.firm_name || '').toLowerCase()}`, l.id)
      }
      for (const r of records) {
        if (r.lead_id) continue
        if (r.linkedin_url && byLinkedIn.has(normalizeLinkedInUrl(r.linkedin_url))) {
          r.lead_id = byLinkedIn.get(normalizeLinkedInUrl(r.linkedin_url))
        } else if (r.lead_name && /@/.test(r.lead_name) && byEmail.has(r.lead_name.toLowerCase())) {
          r.lead_id = byEmail.get(r.lead_name.toLowerCase())
        } else if (r.lead_name && byNameFirm.has(`${r.lead_name.toLowerCase()}|${(r.firm_name || '').toLowerCase()}`)) {
          r.lead_id = byNameFirm.get(`${r.lead_name.toLowerCase()}|${(r.firm_name || '').toLowerCase()}`)
        }
      }
    }
  } catch (e) {
    console.error('logOutreachBatch: lead auto-link failed, importing unlinked', e)
  }

  const { data, error } = await supabase
    .from('crm_outreach_log')
    .insert(records)
    .select('*')
  if (error) throw error

  // Rows imported as already-replied flow into the pipeline like any other
  // reply. Sequential on purpose — each may create a lead and dedup checks
  // must see the previous row's creation.
  for (const row of data || []) {
    if (row.status === 'replied') {
      await syncReplyToPipeline(row, currentPersonId)
    }
  }

  return (data || []).length
}

/**
 * Update outreach entry. Marking an entry 'replied' pushes its person into
 * the pipeline: the linked lead advances to 'responded' (forward-only), or
 * an unlinked entry gets promoted into a lead at 'responded'. This is the
 * Tracker→Pipeline bridge — a reply anywhere shows up in the pipeline
 * without anyone re-entering the contact.
 */
export async function updateOutreach(id, updates, currentPersonId = null) {
  // Stamp when the reply actually arrived. outreach_date is the SEND date, so
  // without this the reply metrics bucket a reply into the week the message
  // went out — which in a targeted motion is routinely weeks earlier.
  const patch = updates.status === 'replied' && updates.replied_at === undefined
    ? { ...updates, replied_at: new Date().toISOString() }
    : updates
  const { data, error } = await supabase
    .from('crm_outreach_log')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error

  if (updates.status === 'replied') {
    await syncReplyToPipeline(data, currentPersonId)
  }
  return data
}

/**
 * Reply→pipeline sync. Never throws — the reply status itself is already
 * saved; a sync failure shouldn't surface as "failed to update status".
 */
async function syncReplyToPipeline(outreachRow, currentPersonId = null) {
  try {
    const personId = currentPersonId ?? outreachRow.logged_by ?? null
    if (outreachRow.lead_id) {
      await advanceLeadStage(outreachRow.lead_id, 'responded', personId)
    } else if (outreachRow.lead_name) {
      await promoteOutreachToLead(outreachRow, personId, { stage: 'responded' })
    }
    cacheClear('leads')
    cacheClear('dashboard')
  } catch (e) {
    console.error('Reply→pipeline sync failed (status update itself succeeded):', e)
  }
}

/**
 * Turn an orphan outreach entry (no lead_id, just lead_name/firm_name) into a
 * real CRM lead so it can be viewed and edited in LeadDetail. Backfills the
 * outreach row's lead_id so future renders link straight through.
 */
export async function promoteOutreachToLead(outreach, currentPersonId, { stage = 'new_lead' } = {}) {
  if (!outreach?.lead_name) throw new Error('Outreach entry has no lead_name to promote')

  const name = String(outreach.lead_name).trim()
  const leadData = {
    name,
    firm_name: outreach.firm_name || null,
    lead_source: outreach.lead_source || null,
    stage
  }
  if (outreach.linkedin_url) leadData.linkedin_url = outreach.linkedin_url

  // If the name field actually holds an email (common for CSV-imported rows),
  // capture the email and fall back to the local-part as a readable name.
  if (/@/.test(name) && /\./.test(name.split('@')[1] || '')) {
    leadData.email = name
    const local = name.split('@')[0].replace(/[._-]+/g, ' ').trim()
    if (local) leadData.name = local.replace(/\b\w/g, c => c.toUpperCase())
  }

  // Roll optional context fields into deal_criteria so they aren't lost.
  const criteriaParts = []
  if (outreach.industry) criteriaParts.push(outreach.industry)
  if (outreach.deal_size) criteriaParts.push(outreach.deal_size)
  if (criteriaParts.length > 0) leadData.deal_criteria = criteriaParts.join(', ')

  // Dedup: prefer linking to an existing lead over creating a duplicate.
  let lead = null
  try {
    lead = await findLeadByEmailOrNameFirm({
      email: leadData.email,
      name: leadData.name,
      firm_name: leadData.firm_name
    })
  } catch (e) {
    console.error('promoteOutreachToLead: dedup lookup failed, falling through to create', e)
  }
  if (!lead) {
    lead = await createLead(leadData, currentPersonId)
  } else if (stage !== 'new_lead') {
    // Reply-driven promotion that matched an existing lead: pull that lead
    // forward to the requested stage (forward-only; never regresses).
    try {
      lead = await advanceLeadStage(lead.id, stage, currentPersonId) || lead
    } catch (e) {
      console.error('promoteOutreachToLead: failed to advance existing lead', e)
    }
  }

  try {
    await updateOutreach(outreach.id, { lead_id: lead.id })
  } catch (e) {
    console.error('promoteOutreachToLead: failed to backfill lead_id', e)
  }

  return lead
}

/**
 * Delete outreach entry
 */
export async function deleteOutreach(id) {
  const { error } = await supabase
    .from('crm_outreach_log')
    .delete()
    .eq('id', id)

  if (error) throw error
}


/**
 * Per-person dashboard stats for the Outreach Tracker header. Legacy RPCs
 * (get_todays_outreach_count / get_outreach_streak / get_daily_outreach_stats)
 * are team-wide, so every user saw the same numbers — this replaces them
 * with a single per-person query that computes the same three shapes
 * client-side.
 */
export async function getPersonDashboardStats(personId, { daysBack = 30, dailyGoal = 10, weekDays = 7 } = {}) {
  if (!personId) return { todayCount: 0, streak: 0, dailyStats: [] }

  const { data, error } = await supabase
    .from('crm_outreach_log')
    .select('outreach_date')
    .eq('logged_by', personId)
    .gte('outreach_date', istAddDays(istDateStr(), -daysBack))
  if (error) throw error

  const today = istDateStr()
  const byDate = new Map()
  for (const r of data || []) {
    byDate.set(r.outreach_date, (byDate.get(r.outreach_date) || 0) + 1)
  }

  const todayCount = byDate.get(today) || 0

  // Streak: consecutive days hitting the goal. Include today if hit;
  // otherwise start from yesterday so a mid-day lull doesn't reset it.
  //
  // A goal of 0 means "no target" (targets were zeroed Aug 2026). Floor the
  // bar at 1 so the streak becomes "days with any outreach" — with a literal
  // 0 the condition `count >= 0` is always true and this loop never
  // terminates, walking backwards through dates forever.
  const streakBar = dailyGoal > 0 ? dailyGoal : 1
  let streak = 0
  let cursor = todayCount >= streakBar ? today : istAddDays(today, -1)
  // Bounded as a backstop: a streak can't be longer than the window we
  // fetched, so this can never spin.
  const maxStreak = Math.max(daysBack, weekDays) + 1
  while ((byDate.get(cursor) || 0) >= streakBar && streak < maxStreak) {
    streak += 1
    cursor = istAddDays(cursor, -1)
  }

  const dailyStats = []
  for (let i = 0; i < weekDays; i += 1) {
    const date = istAddDays(today, -i)
    const count = byDate.get(date) || 0
    dailyStats.push({ date, total_outreaches: count, goal_met: count >= streakBar })
  }

  return { todayCount, streak, dailyStats }
}

// ============================================================================
// OUTREACH ADMIN (all entries, no lead filter)
// ============================================================================

/**
 * Get all outreach log entries across every lead, with optional filters.
 * filters: { platform, days_back, has_response }
 */
export async function getAllOutreachLogs(filters = {}) {
  // Built inside the factory: fetchAllRows calls it once per page and a
  // Supabase query builder is single-use.
  const build = () => {
    let query = supabase
      .from('crm_outreach_log')
      .select(`
        *,
        lead:crm_leads(id, name, firm_name, stage, outreach_stage),
        logged_by_person:logged_by(id, name)
      `)
      .order('outreach_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })

    if (filters.platform) {
      query = query.eq('outreach_type', filters.platform)
    }

    if (filters.has_response === true) {
      query = query.eq('status', 'replied')
    } else if (filters.has_response === false) {
      query = query.neq('status', 'replied')
    }

    if (filters.days_back) {
      query = query.gte('outreach_date', istAddDays(istDateStr(), -filters.days_back))
    }

    if (filters.logged_by) query = query.eq('logged_by', filters.logged_by)
    return query
  }

  return fetchAllRows(build, { maxRows: MAX_LOG_ROWS })
}

/**
 * Lightweight per-person daily outreach records for the last N days.
 * Used to compute today/streak/weekly/best-day dashboards without
 * loading the full outreach rows. Returns: [{logged_by, outreach_date, status}]
 */
// All-time outreach count for a person — drives the career milestone badge
// on the Dashboard. head:true so no rows cross the wire.
export async function getCareerOutreachCount(personId) {
  if (!personId) return 0
  const { count, error } = await supabase
    .from('crm_outreach_log')
    .select('id', { count: 'exact', head: true })
    .eq('logged_by', personId)
  if (error) throw error
  return count || 0
}

/**
 * Weekly funnel for the admin Dashboard: per IST week (Mon-Sun), how much
 * outreach went out, how many replies came back, how many meetings were
 * logged (crm_lead_activities call/meeting), and how many PE OS demos
 * happened (crm_demos by demo_date; signups = demos at stage signed_up).
 * personId null = team-wide (RLS lets admins through).
 * Returns weeks oldest → newest: [{ weekStart, outreach, replies, meetings, demos, signups }]
 */
export async function getWeeklyFunnel(weeksBack = 8, personId = null) {
  const thisWeekStart = istWeekStart(istDateStr())
  const rangeStart = istAddDays(thisWeekStart, -7 * (weeksBack - 1))

  // All three paged — 8 weeks of team-wide outreach passes 1000 rows and a
  // truncated page would just under-count the earliest weeks with no error.
  const [outreach, meetings, demos] = await Promise.all([
    fetchAllRows(() => {
      let q = supabase
        .from('crm_outreach_log')
        .select('outreach_date, status')
        .gte('outreach_date', rangeStart)
      if (personId) q = q.eq('logged_by', personId)
      return q
    }),
    fetchAllRows(() => {
      let q = supabase
        .from('crm_lead_activities')
        .select('activity_date, activity_type')
        .in('activity_type', ['call', 'meeting'])
        .gte('activity_date', rangeStart)
      if (personId) q = q.eq('logged_by', personId)
      return q
    }),
    fetchAllRows(() => {
      let q = supabase
        .from('crm_demos')
        .select('demo_date, stage')
        .not('demo_date', 'is', null)
        .gte('demo_date', rangeStart)
      if (personId) q = q.eq('created_by', personId)
      return q
    })
  ])

  // Seed every week in range so quiet weeks still render as zeros.
  const weeks = new Map()
  for (let i = 0; i < weeksBack; i += 1) {
    const ws = istAddDays(thisWeekStart, -7 * (weeksBack - 1 - i))
    weeks.set(ws, { weekStart: ws, outreach: 0, replies: 0, meetings: 0, demos: 0, signups: 0 })
  }
  const bucket = (dateStr) => weeks.get(istWeekStart(String(dateStr).slice(0, 10)))

  for (const r of outreach) {
    const w = bucket(r.outreach_date)
    if (!w) continue
    w.outreach += 1
    if (r.status === 'replied') w.replies += 1
  }
  for (const r of meetings) {
    const w = bucket(r.activity_date)
    if (w) w.meetings += 1
  }
  for (const r of demos) {
    const w = bucket(r.demo_date)
    if (!w) continue
    w.demos += 1
    if (r.stage === 'signed_up') w.signups += 1
  }

  return [...weeks.values()]
}

export async function getOutreachStatsByPerson(daysBack = 90, personId = null) {
  // Paged: 90 days of team-wide outreach is comfortably past 1000 rows, and
  // every per-person number, heatmap and leaderboard is derived from this.
  const since = istAddDays(istDateStr(), -daysBack)
  return fetchAllRows(() => {
    let q = supabase
      .from('crm_outreach_log')
      .select('logged_by, outreach_date, status, outreach_type, lead_source')
      .gte('outreach_date', since)
    if (personId) q = q.eq('logged_by', personId)
    return q
  })
}

/**
 * Call/meeting activity rows for the last N days, per person. The twin of
 * getOutreachStatsByPerson — Analytics used to run this query inline against
 * supabase, which meant it sat outside the api layer and couldn't inherit the
 * paging fix. Every list query belongs behind fetchAllRows.
 */
export async function getMeetingActivityByPerson(daysBack = 90, personId = null) {
  const since = istAddDays(istDateStr(), -daysBack)
  return fetchAllRows(() => {
    let q = supabase
      .from('crm_lead_activities')
      .select('logged_by, activity_date, activity_type')
      .in('activity_type', ['call', 'meeting'])
      .gte('activity_date', since)
    if (personId) q = q.eq('logged_by', personId)
    return q
  })
}

/**
 * Raw material for Analytics' speed/follow-through metrics: leads created in
 * the window plus every lead-linked outreach touch. Aggregation happens
 * client-side so the page can re-slice by person/window without refetching.
 */
export async function getLeadTouchData(daysBack = 90) {
  const since = istAddDays(istDateStr(), -daysBack)
  // Both sides paginate: an unbounded select stops at PostgREST's 1000-row
  // cap without erroring, which had this computing the speed/follow-through
  // metrics on roughly half the outreach log (1000 of ~2000 rows).
  const [leads, touches] = await Promise.all([
    fetchAllRows(() => supabase
      .from('crm_leads')
      .select('id, created_at, created_by, assigned_to')
      .gte('created_at', since)),
    fetchAllRows(() => supabase
      .from('crm_outreach_log')
      .select('lead_id, outreach_date')
      .not('lead_id', 'is', null))
  ])
  return { leads, touches }
}

// ============================================================================
// OUTREACH ANALYSIS
// ============================================================================

// Send outreach entries (must include message_content + status) to the
// serverless AI analysis function. Returns { summary, observations,
// avg_words_replied, avg_words_not_replied, low_data, total_analyzed,
// replied_count, analyzed_at }.
export async function analyzeOutreach(entries) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')
  const response = await fetch('/api/analyze-outreach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ entries })
  })
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error(result.error || 'Analysis failed')
  return result.analysis
}

// Map<lead_id, latest_outreach_status> for every lead with any outreach
// entry. Used by the Sales Pipeline's response-status filter so leads
// can be sliced by 'replied' / 'no_response' / 'bounced' without the
// page loading the full outreach log.
//
// "Latest" is by outreach_date descending — replies override an earlier
// 'sent' on the same lead, which is the behavior we want.
export async function getLeadLatestOutreachStatus(personId = null) {
  // Paged, with `id` as a tiebreaker. This is the whole outreach log with no
  // date bound — the first query in the app to cross PostgREST's 1000-row cap,
  // and a truncated page silently drops leads out of the response-status
  // filters. The tiebreaker makes the sort total so paging can't duplicate or
  // skip rows at a page boundary.
  const data = await fetchAllRows(() => {
    let q = supabase
      .from('crm_outreach_log')
      .select('id, lead_id, status, outreach_date')
      .not('lead_id', 'is', null)
      .order('outreach_date', { ascending: false })
      .order('id', { ascending: false })
    if (personId) q = q.eq('logged_by', personId)
    return q
  })
  const map = new Map()
  for (const row of data || []) {
    // First row per lead_id wins because we ordered desc.
    if (!map.has(row.lead_id)) map.set(row.lead_id, row.status || 'sent')
  }
  return map
}

// ============================================================================
// LEAD HISTORY (person-hub cards on LeadDetail)
// ============================================================================
// The Goals page (crm_goals / crm_goal_progress) was removed July 2026 —
// outreach targets are now per-user columns on people, set from Admin.

/** All outreach entries linked to a lead, newest first. */
export async function getOutreachForLead(leadId) {
  const { data, error } = await supabase
    .from('crm_outreach_log')
    .select('*, logged_by_person:logged_by(id, name)')
    .eq('lead_id', leadId)
    .order('outreach_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}
