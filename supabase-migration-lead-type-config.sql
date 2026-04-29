-- Add outreach_stage to crm_leads
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS outreach_stage text
  CHECK (outreach_stage IN ('cold', 'messaged', 'replied', 'meeting'));

-- Admin-managed lead type options
CREATE TABLE IF NOT EXISTS crm_lead_type_options (
  id         serial      PRIMARY KEY,
  name       text        NOT NULL,
  sort_order int         NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_lead_type_options_name_key UNIQUE (name)
);

-- Seed defaults
INSERT INTO crm_lead_type_options (name, sort_order) VALUES
  ('PE Firm',              0),
  ('Family Office',        1),
  ('Independent Sponsor',  2),
  ('Other',                3)
ON CONFLICT (name) DO NOTHING;

-- RLS
ALTER TABLE crm_lead_type_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Any authenticated user can read lead type options"
  ON crm_lead_type_options FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage lead type options"
  ON crm_lead_type_options FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM people
      WHERE email = (auth.jwt() ->> 'email')
        AND (is_admin = true OR email = 'dev@pocket-fund.com')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM people
      WHERE email = (auth.jwt() ->> 'email')
        AND (is_admin = true OR email = 'dev@pocket-fund.com')
    )
  );
