-- ============================================
-- CALLHIPPO IMPORT — every dial lands, a human claims it
-- ============================================
-- The team dials on CallHippo, not from the CRM, so calls only reach us by
-- import. Two facts from their API (verified against 53 real records,
-- Sept 2026) shape this:
--
--  1. EVERY call is logged under one shared seat (`hello@pocket-fund.com`,
--     caller "Dev Shah"). CallHippo cannot tell us WHICH analyst dialled.
--     So an imported call arrives UNCLAIMED — `logged_by IS NULL` — and the
--     person who made it claims it. Until then it belongs to nobody and
--     counts toward nobody's target, which is the honest state.
--     (If per-seat CallHippo accounts ever happen, the importer can attribute
--     on `callerEmail` and claiming becomes a fallback, not the main path.)
--
--  2. Their API refuses to return call logs older than one month on this
--     plan ("Kindly upgrade your plan to access call logs for more than
--     1 month(s)"). There is no backfill and no second chance: anything not
--     imported within 30 days is gone forever. So we keep the raw record
--     permanently in `provider_payload` — a mapping bug can then be replayed
--     from our own copy instead of re-fetched from an API that no longer has it.
--
-- Run via the /migrate skill. Idempotent.

ALTER TABLE crm_outreach_log
  -- The raw CallHippo record, exactly as it arrived. Never read by the app;
  -- it exists so a future mapping fix can be replayed against real data.
  ADD COLUMN IF NOT EXISTS provider_payload JSONB,
  -- When a person claimed this call as theirs. NULL on hand-logged rows
  -- (those are attributed at write time) and on imports nobody has claimed.
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- The claim queue: imported calls with no owner yet. Partial so it stays
-- small — it shrinks to nothing as people claim, which is the point.
CREATE INDEX IF NOT EXISTS idx_outreach_unclaimed_calls
  ON crm_outreach_log (called_at DESC)
  WHERE outreach_type = 'phone_call'
    AND provider_call_id IS NOT NULL
    AND logged_by IS NULL;

-- The importer's dedupe check reads this on every sync.
CREATE INDEX IF NOT EXISTS idx_outreach_provider_lookup
  ON crm_outreach_log (call_provider, provider_call_id)
  WHERE provider_call_id IS NOT NULL;
