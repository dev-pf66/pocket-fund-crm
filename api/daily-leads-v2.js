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

    // Prepare for CRM import
    const crmLeads = allLeads.map(lead => ({
      name: lead.name,
      company: lead.company,
      linkedin_url: lead.linkedin_url || null,
      website: lead.website || null,
      stage: 'new',
      lead_type: 'buyer',
      source: lead.source,
      score: lead.score,
      notes: lead.notes,
      assigned_to: aum?.id,
      tags: lead.tags
    }))

    // Check duplicates (by LinkedIn URL or company name)
    const { data: existing } = await supabase
      .from('crm_leads')
      .select('linkedin_url, company')

    const existingLinkedIns = new Set((existing || []).map(e => e.linkedin_url).filter(Boolean))
    const existingCompanies = new Set((existing || []).map(e => e.company?.toLowerCase()))

    const newLeads = crmLeads.filter(lead => {
      if (lead.linkedin_url && existingLinkedIns.has(lead.linkedin_url)) return false
      if (existingCompanies.has(lead.company?.toLowerCase())) return false
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
        leads: data.map(l => ({ name: l.name, company: l.company, source: l.source }))
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

// Crunchbase scraper (NEW)
async function scrapeCrunchbase() {
  try {
    // Search for investors and recently funded companies
    const input = {
      searchQueries: [
        'investor_type:"private_equity" OR investor_type:"family_office"',
        'funding_total:[1000000 TO 50000000]'
      ],
      maxResults: 8,
      includeFields: [
        'name',
        'description',
        'website',
        'num_funding_rounds',
        'funding_total_usd',
        'investor_type',
        'founded_on',
        'num_acquisitions'
      ]
    }

    const run = await apifyClient.actor('curious_coder/crunchbase-scraper').call(input, { timeout: 120 })
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems()

    return (items || [])
      .map(org => ({
        name: extractContactName(org.name),
        company: org.name,
        website: org.website || null,
        linkedin_url: null, // Crunchbase doesn't always have this
        score: scoreCrunchbaseOrg(org),
        source: 'crunchbase_auto',
        notes: `${org.description || 'No description'}\n\nFunding: $${formatMoney(org.funding_total_usd)}\nType: ${org.investor_type || 'Unknown'}\nAcquisitions: ${org.num_acquisitions || 0}`,
        tags: ['crunchbase', org.investor_type || 'company'].filter(Boolean)
      }))
      .filter(l => l.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6) // Max 6 from Crunchbase
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
