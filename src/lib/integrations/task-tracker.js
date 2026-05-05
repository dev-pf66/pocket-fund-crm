// Task Tracker integration dispatcher.
// Called from boston/api/events/fire.js — never imported in the browser.

import { createClient } from '@supabase/supabase-js'

const TT_URL = process.env.TASK_TRACKER_API_URL
const TT_KEY = process.env.TASK_TRACKER_API_KEY

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function ttFetch(path, opts = {}) {
  if (!TT_URL || !TT_KEY) throw new Error('TASK_TRACKER_API_URL / TASK_TRACKER_API_KEY not configured')
  const res = await fetch(`${TT_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-api-key': TT_KEY, ...(opts.headers || {}) }
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) {
    const err = new Error(body?.error || `TT ${res.status}`)
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

const ttPersonCache = new Map()
async function resolveTtPersonByEmail(email) {
  if (!email) return null
  const lower = email.toLowerCase()
  if (ttPersonCache.has(lower)) return ttPersonCache.get(lower)
  const team = await ttFetch('/team')
  for (const p of team) ttPersonCache.set((p.email || '').toLowerCase(), p.id)
  return ttPersonCache.get(lower) || null
}

async function getCrmPerson(personId) {
  const { data, error } = await supabase.from('people').select('id, name, email').eq('id', personId).single()
  if (error) throw error
  return data
}

export const tt = {
  createTask: (payload) => ttFetch('/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  updateTask: (id, updates) => ttFetch(`/tasks?id=${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  completeNextPermaSubtask: (permaTaskId) =>
    ttFetch('/perma-tasks', { method: 'POST', body: JSON.stringify({ action: 'complete_next_subtask', perma_task_id: permaTaskId }) })
}

async function getMapping(entityType, entityKey) {
  const { data } = await supabase.from('crm_tt_mappings')
    .select('*').eq('entity_type', entityType).eq('entity_key', entityKey).maybeSingle()
  return data
}

async function upsertMapping(row) {
  const { data, error } = await supabase.from('crm_tt_mappings').upsert(row, { onConflict: 'entity_type,entity_key' }).select().single()
  if (error) throw error
  return data
}

async function log(row) {
  try { await supabase.from('crm_integration_log').insert([row]) } catch (e) { console.error('integration_log insert failed', e) }
}

// R1: 10 outreaches/day → complete next perma-task subtask for that person.
export async function onOutreachLogged({ outreach }) {
  const personId = outreach.logged_by
  const date = outreach.outreach_date
  if (!personId || !date) return { skipped: 'missing_fields' }

  const { count, error } = await supabase.from('crm_outreach_log')
    .select('id', { count: 'exact', head: true })
    .eq('logged_by', personId).eq('outreach_date', date)
  if (error) throw error

  // Floor instead of exact equality so a batch log that crosses 10 in
  // one go (e.g. 8 → 12 from a CSV upload) still fires. The mapping
  // check below makes this idempotent — we won't fire twice for the
  // same person/day.
  if (count < 10) return { skipped: 'count_below_floor', count }

  const entityKey = `${personId}:${date}`
  const existing = await getMapping('outreach_daily', entityKey)
  if (existing?.metadata?.completed_subtask_id) return { skipped: 'already_fired', mapping: existing }

  const permaMapping = await getMapping('perma_task_daily_outreach', String(personId))
  if (!permaMapping?.tt_perma_task_id) {
    await log({ event_type: 'outreach_daily_complete', status: 'skipped', error_message: 'no perma_task mapped', crm_person_id: personId, payload: { date, count } })
    return { skipped: 'no_perma_task_mapped' }
  }

  try {
    const resp = await tt.completeNextPermaSubtask(permaMapping.tt_perma_task_id)
    await upsertMapping({
      entity_type: 'outreach_daily', entity_key: entityKey,
      crm_person_id: personId, tt_perma_task_id: permaMapping.tt_perma_task_id,
      metadata: { date, completed_subtask_id: resp.subtask?.id, completed: resp.completed }
    })
    await log({ event_type: 'outreach_daily_complete', status: 'ok', crm_person_id: personId, payload: { date, count }, response: resp })
    return { fired: true, response: resp }
  } catch (e) {
    await log({ event_type: 'outreach_daily_complete', status: 'error', crm_person_id: personId, payload: { date, count }, error_message: e.message })
    throw e
  }
}

// R2/R3/R4: lead stage changed.
export async function onLeadStageChanged({ lead, oldStage, actorPersonId }) {
  const newStage = lead.stage
  if (oldStage === newStage) return { skipped: 'no_change' }

  const person = actorPersonId ? await getCrmPerson(actorPersonId) : null
  const ttAssignee = person?.email ? await resolveTtPersonByEmail(person.email) : null
  const firm = lead.firm_name || lead.name || `Lead #${lead.id}`

  const closeLeadTasks = async (reason) => {
    const { data: maps } = await supabase.from('crm_tt_mappings')
      .select('*').eq('crm_lead_id', lead.id).not('tt_task_id', 'is', null)
    for (const m of maps || []) {
      try { await tt.updateTask(m.tt_task_id, { status: 'done' }) } catch (e) { console.error('close task failed', m.tt_task_id, e.message) }
    }
    await log({ event_type: 'lead_tasks_closed', status: 'ok', crm_lead_id: lead.id, payload: { reason, count: (maps || []).length } })
  }

  const createLeadTask = async ({ entityType, title, priority, dueDays, description }) => {
    const existing = await getMapping(entityType, String(lead.id))
    if (existing?.tt_task_id) return { skipped: 'already_exists', mapping: existing }
    const due = new Date(); due.setDate(due.getDate() + dueDays)
    const payload = {
      title, description: description || null, priority,
      status: 'not_started',
      due_date: due.toISOString().split('T')[0],
      assigned_to: ttAssignee, created_by: ttAssignee
    }
    try {
      const resp = await tt.createTask(payload)
      await upsertMapping({
        entity_type: entityType, entity_key: String(lead.id),
        tt_task_id: resp.id, crm_lead_id: lead.id, crm_person_id: actorPersonId || null,
        metadata: { firm, stage_on_create: newStage }
      })
      await log({ event_type: entityType, status: 'ok', crm_lead_id: lead.id, tt_task_id: resp.id, payload, response: resp })
      return { fired: true, task: resp }
    } catch (e) {
      await log({ event_type: entityType, status: 'error', crm_lead_id: lead.id, payload, error_message: e.message })
      throw e
    }
  }

  if (newStage === 'responded') {
    return await createLeadTask({
      entityType: 'lead_reply', title: `Reply to ${firm}`, priority: 'high', dueDays: 1,
      description: `Lead ${firm} responded — send a reply. CRM lead #${lead.id}.`
    })
  }
  if (newStage === 'active_conversation') {
    return await createLeadTask({
      entityType: 'lead_followup', title: `Follow up on ${firm}`, priority: 'high', dueDays: 3,
      description: `Follow up on active conversation with ${firm}. CRM lead #${lead.id}.`
    })
  }
  if (newStage === 'client') {
    await closeLeadTasks('won_client')
    const due = new Date(); due.setDate(due.getDate() + 2)
    const payload = {
      title: `Kickoff: ${firm}`, description: `New client ${firm} — schedule kickoff and send onboarding. CRM lead #${lead.id}.`,
      priority: 'high', status: 'not_started', due_date: due.toISOString().split('T')[0],
      assigned_to: ttAssignee, created_by: ttAssignee
    }
    const resp = await tt.createTask(payload)
    await upsertMapping({
      entity_type: 'lead_kickoff', entity_key: String(lead.id),
      tt_task_id: resp.id, crm_lead_id: lead.id, crm_person_id: actorPersonId || null,
      metadata: { firm, stage_on_create: newStage }
    })
    await log({ event_type: 'lead_kickoff', status: 'ok', crm_lead_id: lead.id, tt_task_id: resp.id, payload, response: resp })
    return { fired: true, task: resp }
  }

  return { skipped: 'stage_not_mapped', stage: newStage }
}
