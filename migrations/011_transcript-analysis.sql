-- Add AI analysis column to crm_transcripts
-- Run this in Supabase SQL Editor

ALTER TABLE crm_transcripts ADD COLUMN IF NOT EXISTS ai_analysis JSONB;

-- Index for querying analysed vs unanalysed transcripts
CREATE INDEX IF NOT EXISTS idx_crm_transcripts_ai_analysis
ON crm_transcripts USING gin(ai_analysis);
