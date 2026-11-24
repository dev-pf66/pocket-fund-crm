-- Add search fund ecosystem and missing lead type options.
-- Idempotent: re-running is a no-op (ON CONFLICT DO NOTHING).
INSERT INTO crm_lead_type_options (name, sort_order) VALUES
  ('Corporate Strategic',    5),
  ('PE OS',                  6),
  ('Search Fund (Funded)',   7),
  ('Self-Funded Searcher',   8),
  ('Aspiring Searcher',      9),
  ('Holdco / Roll-up',      10),
  ('Search Fund Investor',  11),
  ('Intermediary / Advisor',12)
ON CONFLICT (name) DO NOTHING;
