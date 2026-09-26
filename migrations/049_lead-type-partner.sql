-- Add "Partner" as a lead type option.
--
-- Partners (referral / revenue-share counterparties such as Bytera and
-- EliteGate) are neither clients nor investors: they do not buy from us and
-- they do not fund us. With no type for them they were being recorded as
-- "Other" with the real nature buried in free-text notes, which makes them
-- unfilterable and invisible to any pipeline cut.
--
-- Idempotent: re-running is a no-op.
INSERT INTO crm_lead_type_options (name, sort_order) VALUES
  ('Partner', 4)
ON CONFLICT (name) DO NOTHING;
