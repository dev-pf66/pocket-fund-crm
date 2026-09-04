-- 046: flag the leads whose "enrichment" was fabricated.
--
-- api/enrich-linkedin.js used to ask a model to "generate realistic and
-- plausible professional enrichment data" from a LinkedIn URL slug, with no
-- access to the profile, and wrote the result to linkedin_headline,
-- current_position, past_experience and education as though it were fact.
-- All three leads it ever ran on had a blank firm_name, so it invented an
-- employer for each (Venn Capital, Stride Capital, Milestone Capital
-- Partners) plus degrees from ESCP, IIM Ahmedabad and ISB.
--
-- Nothing writes those four columns any more. This does not delete the
-- fabricated values — it relabels the rows so the UI can mark them as
-- unverified, and appends a correction to each lead's activity log next to
-- the original "LinkedIn profile enriched via AI" note.
--
-- Idempotent: re-running matches nothing the second time.

UPDATE crm_leads
SET enrichment_status = 'unverified_ai'
WHERE enrichment_status = 'enriched';

INSERT INTO crm_lead_activities (lead_id, activity_type, activity_date, notes)
SELECT
  l.id,
  'note',
  NOW(),
  'CORRECTION: the earlier "LinkedIn profile enriched via AI" note on this lead was fabricated. '
    || 'The tool that wrote it never read LinkedIn — it invented the headline, role, employer and '
    || 'education from the profile URL alone. Treat those fields as wrong until verified.'
FROM crm_leads l
WHERE l.enrichment_status = 'unverified_ai'
  AND NOT EXISTS (
    SELECT 1 FROM crm_lead_activities a
    WHERE a.lead_id = l.id
      AND a.notes LIKE 'CORRECTION: the earlier%'
  );
