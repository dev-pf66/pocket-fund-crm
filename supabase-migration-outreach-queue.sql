-- Outreach Queue feature
-- Lets a salesperson paste/upload a batch of LinkedIn URLs. Each becomes a
-- crm_leads row tagged with a shared batch id + human label so the queue UI
-- can group them and show per-batch progress.

ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS import_batch_id UUID,
  ADD COLUMN IF NOT EXISTS import_batch_label TEXT;

-- Queue queries filter by (created_by, stage) and group by batch id,
-- so a composite index keeps the per-user queue fast as batches accumulate.
CREATE INDEX IF NOT EXISTS idx_crm_leads_queue
  ON crm_leads (created_by, stage, import_batch_id);
