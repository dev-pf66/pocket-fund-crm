-- Next-steps field: free text so anyone opening a lead's detail view has
-- full context on what to do next, not just stage/owner.
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS next_steps TEXT;
