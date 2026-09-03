-- ============================================
-- COLD CALLS — a dial is not a touch
-- ============================================
-- Cold calling runs on CallHippo (~20 dials per person per day). Before this,
-- a call could only be logged as crm_outreach_log.outreach_type='phone_call'
-- with the EMAIL status vocabulary (sent → replied / no_response / bounced),
-- which cannot express the only distinction that matters on the phone:
--
--   a dial that rang out and a conversation that booked a meeting were the
--   same row, and both counted 1 toward the daily target.
--
-- Dev's call (Sept 2026): dials DO count toward the daily goal, but pickups
-- and conversations are the numbers we actually manage on. So calls stay in
-- crm_outreach_log — one row per DIAL — and every existing target, streak,
-- digest and "My Week" count keeps working untouched. What's added here is the
-- outcome vocabulary that lets us divide those dials into a real funnel:
--
--   dials → pickups (someone answered) → conversations (reached the target)
--         → interested → meetings booked
--
-- `status` is still written on every call row, derived from call_outcome, so
-- reply rate / the weekly digest / the pipeline response filter keep reading
-- one column and don't need to learn about calls. The mapping is defined once
-- in src/lib/callOutcomes.js — see statusForOutcome().
--
-- Run via the /migrate skill. Idempotent.

-- ---------- call columns on the outreach log ----------
ALTER TABLE crm_outreach_log
  -- The outcome vocabulary. NULL on every email / LinkedIn row.
  ADD COLUMN IF NOT EXISTS call_outcome          TEXT,
  -- Did a human pick up? Separate from call_outcome on purpose: a CallHippo
  -- webhook knows answered/not from the carrier, independent of whatever the
  -- caller later selects. This is the honest denominator for pickup rate.
  ADD COLUMN IF NOT EXISTS connected             BOOLEAN,
  ADD COLUMN IF NOT EXISTS call_duration_seconds INTEGER,
  -- Nth dial at this contact — "how many attempts before someone picks up"
  -- is the number that decides when to give up on a lead.
  ADD COLUMN IF NOT EXISTS attempt_number        INTEGER,
  -- outreach_date is a DATE, and "call him back Thursday 3pm" needs a time.
  ADD COLUMN IF NOT EXISTS callback_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_number          TEXT,
  ADD COLUMN IF NOT EXISTS recording_url         TEXT,
  -- When the dial actually happened. outreach_date only has day resolution,
  -- so best-time-of-day analysis had nothing to read.
  ADD COLUMN IF NOT EXISTS called_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS call_provider         TEXT,
  -- Set by an automated import (a CallHippo webhook) so re-delivery of the
  -- same call can't double-count a dial. NULL for hand-logged rows.
  ADD COLUMN IF NOT EXISTS provider_call_id      TEXT;

-- Vocabulary guard. Ordered by funnel depth in src/lib/callOutcomes.js;
-- keep the two lists in step. NULL passes — every non-call row is NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_outreach_log_call_outcome_check'
  ) THEN
    ALTER TABLE crm_outreach_log
      ADD CONSTRAINT crm_outreach_log_call_outcome_check
      CHECK (call_outcome IS NULL OR call_outcome IN (
        'no_answer',      -- rang out, nobody picked up
        'voicemail',      -- left a message
        'bad_number',     -- disconnected / invalid — undeliverable, like a bounce
        'wrong_person',   -- someone answered, but not who we wanted
        'gatekeeper',     -- blocked by reception / assistant
        'not_interested', -- reached them, they said no
        'callback',       -- reached them, they asked for another time
        'interested',     -- reached them, real conversation, wants to continue
        'meeting_booked', -- reached them, meeting on the calendar
        'do_not_call'     -- asked never to be called again
      ));
  END IF;
END $$;

-- A dial can't last a negative number of seconds, and a fat-fingered 999999
-- would silently wreck average talk time.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_outreach_log_call_duration_check'
  ) THEN
    ALTER TABLE crm_outreach_log
      ADD CONSTRAINT crm_outreach_log_call_duration_check
      CHECK (call_duration_seconds IS NULL
             OR (call_duration_seconds >= 0 AND call_duration_seconds <= 86400));
  END IF;
END $$;

-- ---------- indexes ----------
-- The whole Cold Calls tab filters to call rows first, then slices by date.
CREATE INDEX IF NOT EXISTS idx_outreach_calls_by_date
  ON crm_outreach_log (outreach_date DESC, id)
  WHERE outreach_type = 'phone_call';

-- "Who is consistent, who is effective" — per caller, over a window.
CREATE INDEX IF NOT EXISTS idx_outreach_calls_by_person
  ON crm_outreach_log (logged_by, outreach_date DESC)
  WHERE outreach_type = 'phone_call';

-- The callbacks-due queue at the top of Call Mode.
CREATE INDEX IF NOT EXISTS idx_outreach_callback_due
  ON crm_outreach_log (callback_at)
  WHERE callback_at IS NOT NULL;

-- Idempotency for an automated call import. Partial so the thousands of
-- hand-logged NULL rows don't collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_provider_call_id
  ON crm_outreach_log (provider_call_id)
  WHERE provider_call_id IS NOT NULL;

-- ---------- do-not-call ----------
-- Someone who asks not to be called again must never resurface in the call
-- queue. A note in a text field cannot be filtered on; this can.
ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS do_not_call BOOLEAN NOT NULL DEFAULT false;

-- The call queue reads "has a phone, not DNC, mine" on every load.
CREATE INDEX IF NOT EXISTS idx_crm_leads_callable
  ON crm_leads (assigned_to, do_not_call)
  WHERE phone IS NOT NULL AND do_not_call = false;

-- Backfill: every call row that predates this migration gets called_at from
-- its logged timestamp so time-of-day analysis has something to read, and the
-- funnel doesn't show a cliff at the deploy date. Outcome stays NULL — it was
-- never recorded and must not be invented.
UPDATE crm_outreach_log
   SET called_at = created_at
 WHERE outreach_type = 'phone_call'
   AND called_at IS NULL;
