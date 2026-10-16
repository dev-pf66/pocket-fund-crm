import { createClient } from '@supabase/supabase-js'
import { setSupabaseClient, supabase } from '../src/lib/supabase.js'

// The app's own data layer (src/lib/api/*), running server-side for the MCP
// server (Oct 2026).
//
// Logging outreach, logging a call, the reply → pipeline sync, the 30-day
// disposition, the meeting auto-log on leaving meeting_booked: all of that
// lives in src/lib/api/*, written for the browser. A second server-side copy
// would drift from it, which is exactly how this repo has shipped the same bug
// more than once (see migration 049's lead_type fix). So the MCP tools call
// those same functions. All this module does is install a service-role client
// for them, because the browser's anon client has no user session here and RLS
// would hand back empty results.
//
// Two consequences, both deliberate:
//  - Tasks the app normally fires into Sage (fireTTEvent) do NOT fire from
//    here. That path needs a browser session and bails without one. An MCP
//    reply or stage move therefore files no Sage task. No agent writes to
//    Sage (Dev's call).
//  - The session person is passed as currentPersonId wherever the app takes
//    one, so logged_by / created_by / changed_by name a real person.

setSupabaseClient(createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
))

export { getPeople } from '../src/lib/supabase.js'
export {
  getLeadById, getLeadActivities, moveLead, disposeLead, DISPOSITIONS,
} from '../src/lib/api/leads.js'
export {
  getOutreachLog, getOutreachForLead, logOutreach, updateOutreach,
} from '../src/lib/api/outreach.js'
export {
  getCallLog, getCallsForLead, logCall, updateCall, getUnclaimedCalls, claimCall,
  logCallTranscript, setDoNotCall,
} from '../src/lib/api/calls.js'
export { getSellers, createSeller, updateSeller } from '../src/lib/api/sellers.js'
export { getItalyPipeline, createItalyContact, updateItalyContact } from '../src/lib/api/italy-pipeline.js'
export { getDemos, createDemo, updateDemo, getDemosForLead } from '../src/lib/api/demos.js'
export {
  updateInvestor, getInvestorInteractions, logInvestorInteraction,
} from '../src/lib/api/investors.js'
export {
  getLeadTranscripts, getLeadTags, getFieldOptions, getLeadTypeOptions,
} from '../src/lib/api/misc.js'
export { getTodayQueue } from '../src/lib/api/today.js'
export { getNotificationFeed } from '../src/lib/api/notifications.js'
export { getScoreboard, currentWeekBounds } from '../src/lib/api/scoreboard.js'

// Stage history isn't exposed by any app module (the lead page reads it
// inline), so this is the one direct read.
export async function getStageEvents(leadId) {
  const { data, error } = await supabase
    .from('crm_lead_stage_events')
    .select('from_stage, to_stage, changed_at, changed_by_person:changed_by(id, name)')
    .eq('lead_id', leadId)
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw error
  return data || []
}

// One outreach row by id — the MCP update tools read it first to route a
// phone_call row to the call path (whose status is derived, never typed).
export async function getOutreachRow(id) {
  const { data, error } = await supabase
    .from('crm_outreach_log')
    .select('id, outreach_type, lead_id, logged_by')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}
