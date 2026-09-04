-- 047: link a transcript to the specific dial it came from.
--
-- crm_transcripts has only ever known the lead. Cold calling puts up to
-- MAX_CALL_ATTEMPTS dials against the same contact (migration 045), so a
-- lead-only transcript cannot say WHICH conversation it is a record of —
-- the eighth dial's transcript and the first look identical.
--
-- Additive and nullable: every existing transcript keeps working with a NULL
-- outreach_log_id, and nothing is backfilled. ON DELETE SET NULL so removing
-- a call row never cascades into destroying the transcript of it.
--
-- Idempotent: safe to re-run.

ALTER TABLE crm_transcripts
  ADD COLUMN IF NOT EXISTS outreach_log_id INTEGER
  REFERENCES crm_outreach_log(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_transcripts_outreach_log
  ON crm_transcripts(outreach_log_id);
