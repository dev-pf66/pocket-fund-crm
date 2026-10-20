import { fetchAllRows } from './_db.js'
import { normaliseEmail } from '../src/lib/identity.js'

// Email -> CRM person id, for API-key callers that know WHO but not their CRM
// id. The task tracker is the one that needs it: its people table has its own
// ids, so its out-of-office call log could only send unowned leads (which
// POST /api/leads rejects) and unattributed activities (which the scoreboard,
// keyed on logged_by, credits to nobody).
//
// Same join key as sign-in: people.email, case-insensitive (src/lib/identity.js).
// No match, an archived account, or two live rows is an error, never a
// fallback — guessing between duplicate rows is how work lands in the wrong book.
export async function resolvePersonByEmail(supabase, email, field = 'email') {
  const wanted = normaliseEmail(email)
  const people = await fetchAllRows(() => supabase.from('people').select('id, email, is_archived').order('id'))
  const matches = people.filter(p => normaliseEmail(p?.email) === wanted)
  const live = matches.filter(p => !p.is_archived)
  if (live.length === 1) return { id: live[0].id }
  if (live.length > 1) return { error: `${field} ${wanted} matches ${live.length} CRM people — pass the person id instead.` }
  return { error: matches.length
    ? `${field} ${wanted} belongs to an archived CRM account.`
    : `${field} ${wanted} has no CRM account. They need to sign in to the CRM once, or pass the person id.` }
}
