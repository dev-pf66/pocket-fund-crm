-- ============================================
-- 048: back-fill the leads the bulk importer filed as "Unknown"
-- ============================================
-- `bulkCreateLeads` (src/lib/api/queue.js) fell back to the literal string
-- 'Unknown' whenever a LinkedIn slug had no boundary to split on. Twelve leads
-- reached production that way — varunbhambhani, michaeljmostek, jesseypark and
-- nine others — all sharing one indistinguishable name, so the queue showed a
-- column of "Unknown" and nobody could tell one from another.
--
-- The importer now falls back to placeholderNameFromLinkedInUrl, which yields
-- '@slug': unique, visibly unresolved, and it keeps the slug verbatim so a real
-- name can be filled in later. This does the same for the rows already on file.
--
-- Nothing is lost: 'Unknown' carried no information. The slug comes from the
-- row's own linkedin_url, so no name is invented here — '@michaeljmostek' is a
-- handle, not a claim about what anyone is called.
--
-- Rows whose name is 'Unknown' with no LinkedIn URL to derive a handle from are
-- left exactly as they are; there is nothing honest to put there.
--
-- Run via the /migrate skill. Idempotent: after this, no row matches
-- name = 'Unknown' with a /in/ URL, so a second run updates nothing.

UPDATE crm_leads
   SET name = '@' || substring(linkedin_url from '/in/([^/?#]+)')
 WHERE name = 'Unknown'
   -- Personal-profile URLs only. A /company/ or /school/ URL has no personal
   -- slug and must not be turned into someone's name.
   AND linkedin_url ~ '/in/[^/?#]+';
