-- Add call transcript field to activities
ALTER TABLE crm_lead_activities
ADD COLUMN IF NOT EXISTS transcript TEXT;

-- Add index for searching transcripts
CREATE INDEX IF NOT EXISTS idx_crm_lead_activities_transcript
ON crm_lead_activities USING gin(to_tsvector('english', transcript));
