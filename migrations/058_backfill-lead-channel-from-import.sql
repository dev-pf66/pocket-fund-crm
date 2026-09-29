-- ============================================
-- 058: derive lead_channel for the bulk-imported leads
-- ============================================
-- `lead_channel` (052) answers the question Dev actually wants answered: is our
-- inbound or our outbound working, and which deserves more hours. It was empty on
-- 628 of 629 live leads, so the question had no data behind it at all.
--
-- Most of that is genuinely unknowable from the database and stays empty. This
-- fills only the subset where the channel is a FACT rather than a guess.
--
-- THE RULE: a lead with an `import_batch_id` came through `bulkCreateLeads`
-- (src/lib/api/queue.js). That function accepts nothing but LinkedIn profile
-- URLs — it filters its input through `normalizeLinkedInUrl` and drops anything
-- that is not one — and stamps `lead_source = 'Bulk Import'`. So every one of
-- these rows is a LinkedIn profile WE collected and imported. We found them; they
-- did not find us. That is `Outbound — LinkedIn` by the importer's own contract,
-- not by inference about anyone's intent.
--
-- 152 live leads qualify. Deliberately left alone:
--   * 47 leads with outreach rows but no import batch. Their outreach_type says
--     how we CONTACTED them, which is not the same as how they FOUND us — an
--     inbound lead we then messaged on LinkedIn looks identical here. Not a fact.
--   * 430 leads with no evidence of any kind.
--   * `lead_source = 'LinkedIn'` on its own, which is ambiguous in exactly the
--     direction that matters: it does not say who approached whom.
-- Those need a human, which is what the bulk "Set channel" action on the Pipeline
-- board is for.
--
-- NULL-only: a channel someone has already set by hand is never overwritten.
-- One lead (id 899) already carries 'Outbound — cold call' and keeps it.
--
-- Run via the /migrate skill. Idempotent: after this no row matches
-- import_batch_id IS NOT NULL AND lead_channel IS NULL.

UPDATE crm_leads
   SET lead_channel = 'Outbound — LinkedIn'
 WHERE lead_channel IS NULL
   AND import_batch_id IS NOT NULL;

-- Verification:
--   -- expect 0
--   SELECT COUNT(*) FROM crm_leads WHERE lead_channel IS NULL AND import_batch_id IS NOT NULL;
--   -- the split this was all for
--   SELECT COALESCE(lead_channel,'(not recorded)') AS channel, COUNT(*)
--     FROM crm_leads WHERE is_archived = false GROUP BY 1 ORDER BY 2 DESC;
--   -- nobody's hand-set value was clobbered
--   SELECT id, lead_channel FROM crm_leads WHERE id = 899;
