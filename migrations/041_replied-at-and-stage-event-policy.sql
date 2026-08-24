-- ============================================
-- REPLY TIMESTAMP + STAGE-EVENT INSERT POLICY FIX
-- ============================================
-- Two corrections to the "what moved" metrics (migration 040 / commit 8e1e456).
--
-- 1. crm_outreach_log had no reply timestamp. `outreach_date` is the date the
--    message was SENT (004: DEFAULT CURRENT_DATE) and updateOutreach only
--    flips `status`, so "replies this week" was bucketing replies by their
--    send date. In a low-volume, high-targeting motion the reply routinely
--    lands weeks after the send, so a reply received today would score against
--    the week the message went out — i.e. never show up as this week's win,
--    and retroactively change a number someone already read.
--
--    replied_at is set by the app when status transitions to 'replied'.
--    Existing rows stay NULL: the date a historical reply arrived was never
--    recorded and cannot be recovered, so the metric counts from here.
--
-- 2. The stage-event INSERT policy re-read crm_leads to check ownership — but
--    it evaluates AFTER the update that triggered the event. Saving a stage
--    change and a reassignment together (analyst advances a lead, then hands
--    it to a closer) passed the lead update and then had its audit row
--    rejected, because post-update the row is neither created_by nor
--    assigned_to the person who moved it. recordStageChange swallows that,
--    so exactly the hand-off the metric exists to celebrate went unrecorded.
--
--    Any signed-in user may now append. The trail stays append-only (no
--    UPDATE/DELETE policy) and SELECT is still ownership-scoped, so this
--    widens who can write a row, not who can read one.
--
-- Run via the /migrate skill. Idempotent.

ALTER TABLE crm_outreach_log ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_outreach_replied_at
  ON crm_outreach_log(replied_at DESC)
  WHERE replied_at IS NOT NULL;

DROP POLICY IF EXISTS "users_create_lead_stage_events" ON crm_lead_stage_events;
CREATE POLICY "users_create_lead_stage_events" ON crm_lead_stage_events
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Verification:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='crm_outreach_log' AND column_name='replied_at';
-- SELECT policyname, cmd, with_check FROM pg_policies
--   WHERE tablename='crm_lead_stage_events';
