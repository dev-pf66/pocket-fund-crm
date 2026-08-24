-- ============================================
-- LEAD STAGE EVENTS — remember when a lead MOVED
-- ============================================
-- crm_leads.stage holds where a lead is now; the previous value is
-- overwritten on every change. So "how many leads moved forward this week?"
-- — the core question of a low-volume, high-targeting sales motion — was
-- unanswerable, and the weekly digest had to fall back on counting 'meeting'
-- activities (12 in all of history).
--
-- This records one row per stage transition. Append-only, written from the
-- three paths that already compute oldStage: updateLead, moveLead and
-- advanceLeadStage (src/lib/api/leads.js).
--
-- Note it starts empty and only accumulates from deploy — there is no history
-- to backfill, because the old values were never stored.
--
-- RLS mirrors crm_lead_activities exactly: you see events for leads you own
-- or are assigned, admins see everything.
--
-- Run via the /migrate skill. Idempotent.

CREATE TABLE IF NOT EXISTS crm_lead_stage_events (
  id          BIGSERIAL PRIMARY KEY,
  lead_id     INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  from_stage  TEXT,
  to_stage    TEXT NOT NULL,
  changed_by  INTEGER REFERENCES people(id) ON DELETE SET NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "What moved this week" scans by time, then by person.
CREATE INDEX IF NOT EXISTS idx_lead_stage_events_changed_at
  ON crm_lead_stage_events(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_stage_events_by_person
  ON crm_lead_stage_events(changed_by, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_stage_events_lead
  ON crm_lead_stage_events(lead_id, changed_at DESC);

ALTER TABLE crm_lead_stage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_view_own_lead_stage_events" ON crm_lead_stage_events;
CREATE POLICY "users_view_own_lead_stage_events" ON crm_lead_stage_events
  FOR SELECT
  USING (
    current_user_is_admin() OR EXISTS (
      SELECT 1 FROM crm_leads l
      WHERE l.id = crm_lead_stage_events.lead_id
        AND (l.created_by = current_person_id() OR l.assigned_to = current_person_id())
    )
  );

DROP POLICY IF EXISTS "users_create_lead_stage_events" ON crm_lead_stage_events;
CREATE POLICY "users_create_lead_stage_events" ON crm_lead_stage_events
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL AND (
      current_user_is_admin() OR EXISTS (
        SELECT 1 FROM crm_leads l
        WHERE l.id = crm_lead_stage_events.lead_id
          AND (l.created_by = current_person_id() OR l.assigned_to = current_person_id())
      )
    )
  );

-- Deliberately no UPDATE/DELETE policy: this is an append-only audit trail.

-- Verification:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'crm_lead_stage_events' ORDER BY ordinal_position;
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'crm_lead_stage_events';
