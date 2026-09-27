-- ============================================
-- 052: the information every lead is supposed to carry
-- ============================================
-- Dev and Om agreed a lead should answer a fixed set of questions once there
-- has been a conversation: what kind of buyer, how fast they want to move, how
-- they found us, whether they have a thesis, what they have bought before, and
-- how we would get paid.
--
-- Three of those already have columns and are reused rather than duplicated:
--   lead_type          — buyer type (Independent Sponsor / PE Firm / …)
--   investment_thesis  — do they have a thesis
--   lead_source        — kept as-is; the free-text-ish origin label
-- Three did not exist. They are added here.
--
-- THIS IS A FLAG, NOT A GATE (Dev's call). Every column is nullable and there
-- is no NOT NULL, no CHECK that blocks a save and no trigger. The policy lives
-- in src/lib/leadHealth.js and renders as a badge. A hard gate in a shared CRM
-- gets worked around, and what you get back is a lead with invented data in it
-- instead of a lead with a flag on it — this repo already carries three leads
-- with fabricated enrichment, so that is not a hypothetical.
--
-- lead_channel is deliberately its own column rather than more values crammed
-- into lead_source. The question Dev actually wants answered is "is our inbound
-- or our outbound working, and which channel should get more hours" — that
-- needs a small closed vocabulary he can count, not a free text field that ends
-- up holding 'LinkedIn', 'linkedin', 'LI' and 'Linkedin '. lead_source stays
-- untouched so nothing that reads it breaks.
--
-- Run via the /migrate skill. Idempotent.

ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS buying_timeline     TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS lead_channel        TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS prior_acquisitions  TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS engagement_model    TEXT;

-- The channel vocabulary, as editable options rather than a hardcoded array.
-- crm_field_options already backs the Admin → field options editor (migration
-- 021), so Dev can add a channel without a deploy — which is the whole reason
-- the lead_type hardcoded list had to be torn out in Sept 2026.
-- sort_order is explicit: getFieldOptions orders by sort_order THEN value, so
-- without it these render alphabetically and the inbound/outbound split — the
-- thing the field exists to show — gets shuffled together.
INSERT INTO crm_field_options (field_name, value, sort_order) VALUES
  ('lead_channel', 'Outbound — LinkedIn',      0),
  ('lead_channel', 'Outbound — cold email',    1),
  ('lead_channel', 'Outbound — cold call',     2),
  ('lead_channel', 'Inbound — YouTube',        3),
  ('lead_channel', 'Inbound — Kautilya page',  4),
  ('lead_channel', 'Inbound — LinkedIn',       5),
  ('lead_channel', 'Inbound — newsletter',     6),
  ('lead_channel', 'Referral',                 7),
  ('lead_channel', 'Event',                    8),
  ('lead_channel', 'Other',                    9)
ON CONFLICT DO NOTHING;

-- Ordered soonest-first so the list reads as a timeline, not an alphabet.
INSERT INTO crm_field_options (field_name, value, sort_order) VALUES
  ('buying_timeline', 'Actively under LOI / in diligence', 0),
  ('buying_timeline', 'Buying in 0-3 months',              1),
  ('buying_timeline', 'Buying in 3-6 months',              2),
  ('buying_timeline', 'Buying in 6-12 months',             3),
  ('buying_timeline', 'Just looking / no timeline',        4)
ON CONFLICT DO NOTHING;

INSERT INTO crm_field_options (field_name, value, sort_order) VALUES
  ('engagement_model', 'Retainer',                0),
  ('engagement_model', 'Success fee',             1),
  ('engagement_model', 'Retainer + success fee',  2),
  ('engagement_model', 'Not discussed yet',       3)
ON CONFLICT DO NOTHING;

-- Reporting index: "which of my engaged leads are missing their channel" and
-- the inbound-vs-outbound split both scan live, non-archived engaged leads.
CREATE INDEX IF NOT EXISTS idx_crm_leads_channel
  ON crm_leads(lead_channel) WHERE is_archived = false;

-- Verification:
--   SELECT column_name FROM information_schema.columns WHERE table_name='crm_leads'
--     AND column_name IN ('buying_timeline','lead_channel','prior_acquisitions','engagement_model');
--   SELECT field_name, count(*) FROM crm_field_options
--     WHERE field_name IN ('lead_channel','buying_timeline','engagement_model')
--     GROUP BY field_name;
--   -- the flag's blast radius today: engaged, live leads missing any of the six
--   SELECT stage, count(*) FROM crm_leads
--     WHERE is_archived = false
--       AND stage IN ('responded','meeting_booked','warm_active','client')
--     GROUP BY stage;
