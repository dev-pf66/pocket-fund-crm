-- Create dedicated transcripts table
CREATE TABLE IF NOT EXISTS crm_transcripts (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,

  title VARCHAR(200), -- Optional title like "Discovery Call - Feb 10"
  transcript TEXT NOT NULL,
  call_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Metadata
  created_by INTEGER REFERENCES people(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_crm_transcripts_lead ON crm_transcripts(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_transcripts_date ON crm_transcripts(call_date);

-- Full-text search
CREATE INDEX IF NOT EXISTS idx_crm_transcripts_search
ON crm_transcripts USING gin(to_tsvector('english', transcript));

-- RLS
ALTER TABLE crm_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on crm_transcripts"
ON crm_transcripts FOR ALL USING (true) WITH CHECK (true);

-- Trigger
CREATE TRIGGER crm_transcripts_updated_at
  BEFORE UPDATE ON crm_transcripts
  FOR EACH ROW
  EXECUTE FUNCTION update_crm_updated_at();
