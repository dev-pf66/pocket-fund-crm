/**
 * Multi-Source Lead Finder - LinkedIn + Crunchbase
 * Finds business buyers from multiple sources for better quality
 */

import { ApifyClient } from 'apify-client'
import { createClient } from '@supabase/supabase-js'

const apifyClient = new ApifyClient({
  token: process.env.APIFY_API_TOKEN
})

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  // Verify cron secret
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    console.log('Starting multi-source lead import...')

    // Run both scrapers in parallel
    const [linkedInLeads, crunchbaseLeads] = await Promise.all([
      scrapeLinkedIn(),
      scrapeCrunchbase()
    ])

    console.log(`Found ${linkedInLeads.length} from LinkedIn, ${crunchbaseLeads.length} from Crunchbase`)

    // Merge and deduplicate
    const allLeads = [...linkedInLeads, ...crunchbaseLeads]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10) // Take best 10 total

    // Get Aum's ID
    const { data: aum } = await supabase
      .from('people')
      .select('id')
      .ilike('name', '%aum%')
      .single()

    // Prepare for CRM import.
    // Column names must match crm_leads exactly: firm_name / lead_source /
    // lead_score — NOT company / source / score. Writing the latter made every
    // insert fail with PGRST204, which silently killed this cron.
    // The scrapers score 0-5; crm_leads.lead_score is CHECKed 0-100, so scale.
    // There is no `website` or `tags` column — the URL folds into notes, and
    // provenance is carried by lead_source.
    const crmLeads = allLeads.map(lead => ({
      name: lead.name,
      firm_name: lead.company || null,
      linkedin_url: lead.linkedin_url || null,
      stage: 'new_lead',
      lead_source: lead.source,
      lead_score: Math.min(100, Math.max(0, (lead.score || 0) * 20)),
      notes: [lead.notes, lead.website ? `Website: ${lead.website}` : null]
        .filter(Boolean).join('\n'),
      assigned_to: aum?.id || null
    }))

    // Check duplicates (by LinkedIn URL or firm name). Paginated: PostgREST
    // caps a plain select at 1000 rows, which would silently defeat the
    // dedupe once crm_leads outgrows that. The error is checked now too — it
    // used to be discarded, so a failed query looked like "no duplicates".
    const existing = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('crm_leads')
        .select('linkedin_url, firm_name')
        .range(from, from + 999)
      if (error) throw error
      existing.push(...(data || []))
      if ((data || []).length < 1000) break
    }

    const existingLinkedIns = new Set(existing.map(e => e.linkedin_url).filter(Boolean))
    const existingFirms = new Set(existing.map(e => e.firm_name?.toLowerCase()).filter(Boolean))

    const newLeads = crmLeads.filter(lead => {
      if (lead.linkedin_url && existingLinkedIns.has(lead.linkedin_url)) return false
      if (lead.firm_name && existingFirms.has(lead.firm_name.toLowerCase())) return false
      return true
    })

    if (newLeads.length > 0) {
      const { data, error } = await supabase
        .from('crm_leads')
        .insert(newLeads)
        .select()

      if (error) throw error

      return res.status(200).json({
        success: true,
        imported: data.length,
        skipped: crmLeads.length - newLeads.length,
        breakdown: {
          linkedin: linkedInLeads.length,
          crunchbase: crunchbaseLeads.length
        },
        leads: data.map(l => ({ name: l.name, firm_name: l.firm_name, lead_source: l.lead_source }))
      })
    }

    return res.status(200).json({
      success: true,
      imported: 0,
      skipped: crmLeads.length,
      message: 'All leads were duplicates'
    })
  } catch (error) {
    console.error('Multi-source leads error:', error)
    return res.status(500).json({
      success: false,
      error: error.message
    })
  }
}

// LinkedIn scraper (same as before)
async function scrapeLinkedIn() {
  try {
    const input = {
      searchUrl: 'https://www.linkedin.com/search/results/people/?keywords=CEO%20acquisitions%20investor%20search%20fund',
      maxResults: 8,
      proxyConfiguration: { useApifyProxy: true }
    }

    const run = await apifyClient.actor('apify/linkedin-profile-scraper').call(input, { timeout: 120 })
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems()

    return (items || [])
      .map(profile => ({
        name: profile.fullName || 'Unknown',
        linkedin_url: profile.url,
        company: profile.company || 'N/A',
        website: profile.companyWebsite || null,
        score: scoreLinkedInProfile(profile),
        source: 'linkedin_auto',
        notes: `LinkedIn: ${profile.headline || 'No headline'}\nLocation: ${profile.location || 'Unknown'}`,
        tags: ['linkedin']
      }))
      .filter(l => l.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6) // Max 6 from LinkedIn
  } catch (error) {
    console.error('LinkedIn scrape failed:', error)
    return []
  }
}

// Crunchbase scraper (NEW) - TODO: Configure proper input format
async function scrapeCrunchbase() {
  try {
    console.log('Crunchbase scraping temporarily disabled - needs API configuration')
    // TODO: Configure correct input format for curious_coder/crunchbase-scraper
    // For now, return empty array to let LinkedIn scraper work
    return []

    /* Original code - keeping for reference:
    const input = {
      searchQueries: [
        'investor_type:"private_equity" OR investor_type:"family_office"',
        'funding_total:[1000000 TO 50000000]'
      ],
      maxResults: 8
    }
    const run = await apifyClient.actor('curious_coder/crunchbase-scraper').call(input, { timeout: 120 })
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems()
    return (items || []).map(org => ({...})).filter(l => l.score >= 3).slice(0, 6)
    */
  } catch (error) {
    console.error('Crunchbase scrape failed:', error)
    return []
  }
}

// Scoring functions
function scoreLinkedInProfile(profile) {
  let score = 0
  const text = ((profile.headline || '') + ' ' + (profile.summary || '')).toLowerCase()

  if (text.includes('acquisition') || text.includes('m&a')) score += 2
  if (text.includes('search fund') || text.includes('eir')) score += 3
  if (text.includes('investor') || text.includes('partner')) score += 1
  if (text.includes('ceo') || text.includes('founder')) score += 1
  if (profile.connectionsCount > 500) score += 1

  return Math.min(score, 5)
}

function scoreCrunchbaseOrg(org) {
  let score = 0

  // Investor type signals
  if (org.investor_type === 'private_equity') score += 3
  if (org.investor_type === 'family_office') score += 3
  if (org.investor_type === 'venture_capital') score += 2

  // Active acquirer
  if (org.num_acquisitions > 0) score += 2
  if (org.num_acquisitions >= 3) score += 1

  // Recently funded = has capital
  if (org.funding_total_usd >= 1000000) score += 1
  if (org.funding_total_usd >= 10000000) score += 1

  // Multiple funding rounds = sophisticated
  if (org.num_funding_rounds >= 2) score += 1

  return Math.min(score, 5)
}

// Helper to extract contact name from company name
function extractContactName(companyName) {
  // If company has a person's name format, use it
  if (companyName.includes(' & ')) {
    return companyName.split(' & ')[0]
  }
  // Otherwise return "Contact at [Company]"
  return `Contact at ${companyName}`
}

function formatMoney(amount) {
  if (!amount) return '0'
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `${(amount / 1000).toFixed(0)}K`
  return amount.toString()
}
