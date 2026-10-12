import { createClient } from '@supabase/supabase-js'
import { fetchAllRows } from './_db.js'
import { normaliseEmail } from '../src/lib/identity.js'

// Who is at the keyboard, per MCP conversation (Oct 2026, Dev's call).
//
// Several people use Dev's Claude account, so the connector's OAuth token
// identifies the ACCOUNT, never the person. Rule: every MCP conversation asks
// the human who is using it, opens a session for that person, and passes the
// session id on every tool call. A session ends when they say they're done
// (end_session) or after MCP_SESSION_IDLE_MINUTES without a call — and then
// the next call is refused until someone says who they are again.
//
// The session id lives in the conversation itself (the model carries it), so
// a NEW chat has no session and must ask — that is the "every time it
// restarts" half of the rule. The idle timeout is the "once they stop using
// it" half, and it is enforced here, server-side, not left to the model.
//
// Limits, stated plainly: this is identification, not authentication. Nothing
// stops someone typing a colleague's name. What it buys is that nobody is
// silently assumed — and that every write says who claimed to make it
// (crm_mcp_sessions is the trail). Table: migration 060.

export const MCP_SESSION_IDLE_MINUTES = 30

const ASK = 'Ask the human "Who is using the CRM right now?" and call start_session with their answer. ' +
  'Do NOT pick a person yourself — not from the Claude account, the signed-in email, memory, or earlier in this chat. ' +
  'Several people share this account.'

let client
function db() {
  client ??= createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  return client
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Same exclusion as the scoreboard: dev+localtest is a test account.
function isPickable(p) {
  return !p.is_archived && !/\+localtest/.test(p.email || '')
}

/**
 * Match "who is using it" to exactly one live person. Pure, so it is tested
 * directly. Order: exact email, exact name, then a unique partial (first name,
 * name prefix, email local part). Never guesses between two matches.
 * Returns { person } or { error: 'empty'|'ambiguous'|'not_found', candidates }.
 */
export function resolvePerson(people, answer) {
  const live = (people || []).filter(isPickable)
  const q = String(answer ?? '').trim().toLowerCase()
  if (!q) return { error: 'empty', candidates: live }

  const one = (list) => (list.length === 1 ? list[0] : null)
  const name = (p) => String(p.name || '').trim().toLowerCase()

  const exact = one(live.filter((p) => normaliseEmail(p.email) === q)) ||
    one(live.filter((p) => name(p) === q))
  if (exact) return { person: exact }

  const partial = live.filter((p) =>
    name(p).split(/\s+/).includes(q) ||
    name(p).startsWith(q) ||
    normaliseEmail(p.email).split('@')[0] === q)
  if (partial.length === 1) return { person: partial[0] }
  if (partial.length > 1) return { error: 'ambiguous', candidates: partial }
  return { error: 'not_found', candidates: live }
}

const label = (p) => `${p.name} (${p.email})`

export async function startSession(answer, account) {
  const people = await fetchAllRows(() => db().from('people').select('id, name, email, is_archived').order('id'))
  const r = resolvePerson(people, answer)
  if (r.error) {
    const why = r.error === 'ambiguous'
      ? `"${answer}" matches more than one person. Ask which one:`
      : r.error === 'empty' ? 'No name given. Ask who is using the CRM. Team:' : `Nobody on the team matches "${answer}". Ask again. Team:`
    return { ok: false, message: `${why}\n${r.candidates.map(label).join('\n')}` }
  }
  const { data, error } = await db().from('crm_mcp_sessions')
    .insert({ person_id: r.person.id, account_email: account || null })
    .select('id').single()
  if (error) throw error
  return { ok: true, sessionId: data.id, person: r.person }
}

async function endRow(id, reason) {
  const { error } = await db().from('crm_mcp_sessions')
    .update({ ended_at: new Date().toISOString(), ended_reason: reason })
    .eq('id', id).is('ended_at', null)
  if (error) throw error
}

/**
 * Gate for every CRM tool. Returns { ok: true, person } or
 * { ok: false, message } — the message tells the model to go and ask.
 */
export async function checkSession(sessionId, account, now = new Date()) {
  if (!sessionId || !UUID.test(sessionId)) return { ok: false, message: `No active session. ${ASK}` }

  const { data: s, error } = await db().from('crm_mcp_sessions')
    .select('id, person_id, account_email, last_seen_at, ended_at, ended_reason, tool_calls, people(id, name, email, is_archived)')
    .eq('id', sessionId).maybeSingle()
  if (error) throw error
  // A session opened under another account is treated as unknown, not leaked.
  if (!s || (s.account_email || null) !== (account || null)) return { ok: false, message: `No active session. ${ASK}` }

  if (s.ended_at) {
    return { ok: false, message: `That session (${s.people?.name}) has ended. ${ASK}` }
  }
  const idleMs = now - new Date(s.last_seen_at)
  if (idleMs > MCP_SESSION_IDLE_MINUTES * 60_000) {
    await endRow(s.id, 'idle')
    return { ok: false, message: `The session for ${s.people?.name} ended after ${MCP_SESSION_IDLE_MINUTES} minutes idle. ${ASK}` }
  }
  if (!s.people || s.people.is_archived) {
    await endRow(s.id, 'archived')
    return { ok: false, message: `That person's CRM account is archived. ${ASK}` }
  }

  const { error: touchErr } = await db().from('crm_mcp_sessions')
    .update({ last_seen_at: now.toISOString(), tool_calls: (s.tool_calls || 0) + 1 })
    .eq('id', s.id)
  if (touchErr) throw touchErr
  return { ok: true, person: s.people }
}

export async function endSession(sessionId, account) {
  if (!sessionId || !UUID.test(sessionId)) return { ok: false, message: 'No such session.' }
  const { data: s, error } = await db().from('crm_mcp_sessions')
    .select('id, account_email, ended_at, people(name)').eq('id', sessionId).maybeSingle()
  if (error) throw error
  if (!s || (s.account_email || null) !== (account || null)) return { ok: false, message: 'No such session.' }
  if (!s.ended_at) await endRow(s.id, 'user_ended')
  return { ok: true, name: s.people?.name }
}

export const SESSION_INSTRUCTIONS =
  'Several people share this Claude account, so you never know who is using the CRM until you ask. ' +
  'At the start of EVERY conversation, before any other CRM tool, ask the human "Who is using the CRM right now?" ' +
  'and call start_session with their answer — never infer it from the account, the signed-in email, memory, or a previous conversation. ' +
  'Pass the returned session_id to every other tool. ' +
  `A session ends after ${MCP_SESSION_IDLE_MINUTES} minutes without a CRM call, or when the human says they are done (call end_session). ` +
  'When a tool says the session has ended, ask who is using it again — even if it seems to be the same person. ' +
  'Leads, activities and stage moves you create are attributed to the session\'s person.'
