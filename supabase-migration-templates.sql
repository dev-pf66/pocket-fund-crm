-- Email Templates table
CREATE TABLE IF NOT EXISTS crm_email_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  category VARCHAR(50) NOT NULL, -- 'outreach', 'followup', 'samples', 'proposal', 'meeting'
  created_by INTEGER REFERENCES people(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_crm_email_templates_category ON crm_email_templates(category);
CREATE INDEX IF NOT EXISTS idx_crm_email_templates_active ON crm_email_templates(is_active);

-- Enable RLS
ALTER TABLE crm_email_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policy
CREATE POLICY "Allow all operations on crm_email_templates" ON crm_email_templates FOR ALL USING (true) WITH CHECK (true);

-- Trigger
CREATE TRIGGER crm_email_templates_updated_at
  BEFORE UPDATE ON crm_email_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_crm_updated_at();
