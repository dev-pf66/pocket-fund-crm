/**
 * Apify Lead Finder - Scrapes LinkedIn for business buyers
 * Target: $1-50M net worth, looking to acquire in next 6 months
 * Output: 10 leads per day → auto-import to CRM
 */

import { ApifyClient } from 'apify-client'
import { createClient } from '@supabase/supabase-js'

const apifyClient = new ApifyClient({
  token: process.env.APIFY_API_TOKEN
})

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // needs service role for server-side
)

// LinkedIn search parameters for business buyers
const SEARCH_CONFIG = {
  // Job titles indicating buying intent
  titles: [
    'CEO',
    'Founder',
    'Managing Partner',
    'Investment Director',
    'Principal',
    'Partner',
    'Investor',
    'Serial Entrepreneur',
    'Business Owner'
  ],

  // Industries
  industries: [
    'Private Equity',
    'Venture Capital & Private Equity',
    'Investment Management',
    'Financial Services',
    'Family Office'
  ],

  // Company size signals (1-50M usually = 10-100 employees)
  companySizeMin: 1,
  companySizeMax: 100,

  // Locations (USA focus)
  locations: [
    'United States',
    'New York',
    'California',
    'Texas',
    'Florida'
  ],

  // Keywords in profile/headline
  keywords: [
    'acquisitions',
    'M&A',
    'buying businesses',
    'search fund',
    'acquiring',
    'investor',
    'entrepreneur in residence'
  ]
}

async function findLeads(maxLeads = 10) {
  console.log('🔍 Starting LinkedIn lead search...')

  // Use Apify's LinkedIn People Search actor
  const input = {
    searchUrls: generateSearchUrls(),
    maxResults: maxLeads * 2, // get extra to filter
    proxyConfiguration: { useApifyProxy: true }
  }

  console.log('Running Apify actor...')
  const run = await apifyClient.actor('apify/linkedin-profile-scraper').call(input)

  // Get results
  const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems()

  console.log(`Found ${items.length} raw profiles`)

  // Filter and score leads
  const scoredLeads = items
    .map(scoreProfile)
    .filter(lead => lead.score >= 3) // min quality threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLeads)

  console.log(`✓ ${scoredLeads.length} high-quality leads after filtering`)

  return scoredLeads
}

function generateSearchUrls() {
  // Generate LinkedIn search URLs targeting buyers
  const urls = []

  SEARCH_CONFIG.titles.slice(0, 3).forEach(title => {
    SEARCH_CONFIG.industries.slice(0, 2).forEach(industry => {
      const query = encodeURIComponent(`${title} ${industry} acquisitions`)
      urls.push(`https://www.linkedin.com/search/results/people/?keywords=${query}`)
    })
  })

  return urls
}

function scoreProfile(profile) {
  let score = 0
  const headline = (profile.headline || '').toLowerCase()
  const summary = (profile.summary || '').toLowerCase()
  const combined = headline + ' ' + summary

  // Score based on signals
  if (SEARCH_CONFIG.keywords.some(kw => combined.includes(kw))) score += 2
  if (combined.includes('buy') && combined.includes('business')) score += 2
  if (combined.includes('search fund') || combined.includes('eir')) score += 3
  if (SEARCH_CONFIG.titles.some(t => headline.includes(t.toLowerCase()))) score += 1
  if (profile.connectionsCount > 500) score += 1

  return {
    name: profile.fullName || 'Unknown',
    linkedin_url: profile.url,
    company: profile.company || 'N/A',
    headline: profile.headline || '',
    location: profile.location || '',
    score,
    raw_data: profile
  }
}

async function importToCRM(leads, assignToPersonId = null) {
  console.log(`\n💾 Importing ${leads.length} leads to CRM...`)

  const crmLeads = leads.map(lead => ({
    name: lead.name,
    company: lead.company,
    linkedin_url: lead.linkedin_url,
    stage: 'new',
    lead_type: 'buyer',
    source: 'apify_linkedin',
    score: lead.score,
    notes: `Auto-imported via Apify\nHeadline: ${lead.headline}\nLocation: ${lead.location}`,
    assigned_to: assignToPersonId,
    created_at: new Date().toISOString()
  }))

  // Check for duplicates first
  const existingUrls = crmLeads.map(l => l.linkedin_url).filter(Boolean)
  const { data: existing } = await supabase
    .from('crm_leads')
    .select('linkedin_url')
    .in('linkedin_url', existingUrls)

  const existingSet = new Set((existing || []).map(e => e.linkedin_url))
  const newLeads = crmLeads.filter(l => !existingSet.has(l.linkedin_url))

  if (newLeads.length === 0) {
    console.log('⚠️  All leads already exist (duplicates)')
    return { imported: 0, skipped: crmLeads.length }
  }

  // Insert new leads
  const { data, error } = await supabase
    .from('crm_leads')
    .insert(newLeads)
    .select()

  if (error) {
    console.error('❌ Import failed:', error.message)
    throw error
  }

  console.log(`✅ Imported ${data.length} new leads, skipped ${crmLeads.length - newLeads.length} duplicates`)

  return {
    imported: data.length,
    skipped: crmLeads.length - newLeads.length,
    leads: data
  }
}

// Main execution
async function main() {
  try {
    const targetLeads = parseInt(process.env.DAILY_LEAD_TARGET || '10')

    // Find leads
    const leads = await findLeads(targetLeads)

    // Get Aum's person ID (assigned analyst)
    const { data: aum } = await supabase
      .from('people')
      .select('id')
      .ilike('name', '%aum%')
      .single()

    // Import to CRM
    const result = await importToCRM(leads, aum?.id)

    // Log the run
    console.log('\n' + '='.repeat(50))
    console.log('Daily Lead Import Complete')
    console.log('='.repeat(50))
    console.log(`Leads imported: ${result.imported}`)
    console.log(`Duplicates skipped: ${result.skipped}`)
    console.log(`Assigned to: ${aum?.id ? 'Aum' : 'Unassigned'}`)

    return result
  } catch (error) {
    console.error('Fatal error:', error)
    process.exit(1)
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

export { findLeads, importToCRM }
