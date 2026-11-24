-- Add message_content to crm_leads for storing the initial outreach message
-- captured during CSV import or manual entry.
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS message_content TEXT;
