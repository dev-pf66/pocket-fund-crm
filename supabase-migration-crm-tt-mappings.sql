-- CRM ↔ Task Tracker integration tables

CREATE TABLE IF NOT EXISTS crm_tt_mappings (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  entity_key VARCHAR(200) NOT NULL,
  tt_task_id INTEGER,
  tt_perma_task_id INTEGER,
  tt_person_id INTEGER,
  crm_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  crm_lead_id INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (entity_type, entity_key)
);

CREATE INDEX IF NOT EXISTS idx_crm_tt_mappings_lead ON crm_tt_mappings(crm_lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_tt_mappings_person ON crm_tt_mappings(crm_person_id);
CREATE INDEX IF NOT EXISTS idx_crm_tt_mappings_tt_task ON crm_tt_mappings(tt_task_id);

CREATE TABLE IF NOT EXISTS crm_integration_log (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
  status VARCHAR(20) NOT NULL,
  payload JSONB,
  response JSONB,
  error_message TEXT,
  crm_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  crm_lead_id INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
  tt_task_id INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_integration_log_event ON crm_integration_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_integration_log_status ON crm_integration_log(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_integration_log_lead ON crm_integration_log(crm_lead_id);

ALTER TABLE crm_tt_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_integration_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on crm_tt_mappings" ON crm_tt_mappings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on crm_integration_log" ON crm_integration_log FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION update_crm_tt_mappings_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crm_tt_mappings_updated_at ON crm_tt_mappings;
CREATE TRIGGER crm_tt_mappings_updated_at
  BEFORE UPDATE ON crm_tt_mappings
  FOR EACH ROW EXECUTE FUNCTION update_crm_tt_mappings_updated_at();
