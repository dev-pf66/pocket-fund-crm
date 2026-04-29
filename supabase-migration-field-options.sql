-- Generic admin-managed dropdown options for outreach log fields
CREATE TABLE IF NOT EXISTS crm_field_options (
  id         serial      PRIMARY KEY,
  field_name text        NOT NULL,
  value      text        NOT NULL,
  sort_order int         NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_field_options_field_value_key UNIQUE (field_name, value)
);

-- Seed defaults
INSERT INTO crm_field_options (field_name, value, sort_order) VALUES
  -- Industry
  ('industry', 'SaaS',                 0),
  ('industry', 'E-commerce',           1),
  ('industry', 'F&B',                  2),
  ('industry', 'Healthcare',           3),
  ('industry', 'Manufacturing',        4),
  ('industry', 'Real Estate',          5),
  ('industry', 'Financial Services',   6),
  ('industry', 'Technology',           7),
  ('industry', 'Other',                8),
  -- Deal Size
  ('deal_size', 'Under $1M',           0),
  ('deal_size', '$1M–$5M',             1),
  ('deal_size', '$5M–$10M',            2),
  ('deal_size', '$10M–$25M',           3),
  ('deal_size', '$25M–$50M',           4),
  ('deal_size', '$50M+',               5),
  -- Location
  ('location', 'New York',             0),
  ('location', 'Los Angeles',          1),
  ('location', 'Chicago',              2),
  ('location', 'Houston',              3),
  ('location', 'Miami',                4),
  ('location', 'London',               5),
  ('location', 'India',                6),
  ('location', 'Remote',               7),
  ('location', 'Other',                8),
  -- Lead Source
  ('lead_source', 'LinkedIn',          0),
  ('lead_source', 'Referral',          1),
  ('lead_source', 'Conference',        2),
  ('lead_source', 'Cold Email',        3),
  ('lead_source', 'Website',           4),
  ('lead_source', 'Other',             5)
ON CONFLICT (field_name, value) DO NOTHING;

-- RLS
ALTER TABLE crm_field_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Any authenticated user can read field options"
  ON crm_field_options FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage field options"
  ON crm_field_options FOR ALL TO authenticated
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
