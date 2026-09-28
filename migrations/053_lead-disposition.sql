-- ============================================
-- 053: the 30-day disposition — and WHY a lead died
-- ============================================
-- Dev, 27 Sept 2026: "the whole point of the thirty day thing is that the person
-- who's responsible for the lead has to update it. After those thirty days they
-- have to update the lead, because otherwise — if the lead is dead we have to
-- mark it as dead, or if they've said get back to me after three months we need
-- a way for the person to be updated like that. So we know exactly what's
-- happening with each of our leads."
--
-- The stage already records the OUTCOME (`passed`, `reach_out_later`). What was
-- never recorded is the REASON, so "we passed on 300 leads" was a number with no
-- content — you could not tell price from timing from ghosting, which are three
-- completely different problems.
--
--   dead_reason        — why, from an admin-editable vocabulary (Dev's call:
--                        "there should be a reason and the reason why should be a
--                        drop down, to which they can add more reasons... the
--                        administration can be in the admin side")
--   dead_reason_note   — the free-text detail, because a dropdown value alone
--                        loses the one sentence that actually helps next time
--   disposed_at        — when the lead was last explicitly dispositioned. This is
--                        what makes the running 30-day clock answerable: not "has
--                        anyone touched it" but "has anyone SAID what is
--                        happening with it".
--   disposed_by        — who said so. ON DELETE SET NULL, mirroring assigned_by.
--
-- All nullable. Nothing is enforced by a NOT NULL or a CHECK: the 30-day rule is
-- a FLAG, not a gate (migration 052 and src/lib/leadHealth.js), and a constraint
-- that blocks a save produces invented reasons rather than honest ones.
--
-- Deliberately NOT a new stage. `passed` and `reach_out_later` already exist and
-- STAGE_ORDER is load-bearing for the forward-only automation — adding a stage
-- would change what "forward" means. This annotates the existing outcome.
--
-- Run via the /migrate skill. Idempotent.

ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS dead_reason      TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS dead_reason_note TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS disposed_at      TIMESTAMPTZ;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS disposed_by      INTEGER
  REFERENCES people(id) ON DELETE SET NULL;

-- The vocabulary, in crm_field_options so Admin → field options can extend it
-- without a deploy — the same reason the hardcoded lead_type list was removed.
-- sort_order is explicit because getFieldOptions sorts by sort_order THEN value,
-- and these are not meaningfully alphabetical.
INSERT INTO crm_field_options (field_name, value, sort_order) VALUES
  ('dead_reason', 'Not interested',                    0),
  ('dead_reason', 'No response after follow-ups',      1),
  ('dead_reason', 'Budget too small',                  2),
  ('dead_reason', 'Wants to buy, not to be advised',   3),
  ('dead_reason', 'Timing — not buying this year',     4),
  ('dead_reason', 'Went with someone else',            5),
  ('dead_reason', 'Not a real buyer / tyre-kicker',    6),
  ('dead_reason', 'Wrong fit for our mandate',         7),
  ('dead_reason', 'Bad contact details',               8),
  ('dead_reason', 'Better as an investor',             9),
  ('dead_reason', 'Better as a partner',              10),
  ('dead_reason', 'Other',                            11)
ON CONFLICT DO NOTHING;

-- "Which leads has nobody dispositioned" is the scoreboard's breach query.
CREATE INDEX IF NOT EXISTS idx_crm_leads_disposed_at
  ON crm_leads(disposed_at) WHERE is_archived = false;

-- Verification:
--   SELECT column_name FROM information_schema.columns WHERE table_name='crm_leads'
--     AND column_name IN ('dead_reason','dead_reason_note','disposed_at','disposed_by');
--   SELECT value, sort_order FROM crm_field_options WHERE field_name='dead_reason' ORDER BY sort_order;
--   -- why we actually lose leads, once this has been used for a month
--   SELECT dead_reason, count(*) FROM crm_leads WHERE stage='passed' GROUP BY 1 ORDER BY 2 DESC;
