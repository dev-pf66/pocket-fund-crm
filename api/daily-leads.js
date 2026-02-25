/**
 * Vercel Serverless Function - Daily Lead Import
 * Triggered by cron: runs every day at 9am
 * GET /api/daily-leads?key=SECRET
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
    console.log('Starting daily lead import...')

    // LinkedIn search for business buyers
    const input = {
      searchUrl: 'https://www.linkedin.com/search/results/people/?keywords=CEO%20acquisitions%20investor',
      maxResults: 15, // get 15, filter to best 10
      proxyConfiguration: { useApifyProxy: true }
    }

    const run = await apifyClient.actor('apify/linkedin-profile-scraper').call(input)
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems()

    // Score and filter
    const scoredLeads = items
      .map(profile => ({
        name: profile.fullName || 'Unknown',
        linkedin_url: profile.url,
        company: profile.company || 'N/A',
        headline: profile.headline || '',
        score: scoreProfile(profile)
      }))
      .filter(l => l.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)

    // Get Aum's ID
    const { data: aum } = await supabase
      .from('people')
      .select('id')
      .ilike('name', '%aum%')
      .single()

    // Import to CRM
    const crmLeads = scoredLeads.map(lead => ({
      name: lead.name,
      company: lead.company,
      linkedin_url: lead.linkedin_url,
      stage: 'new',
      lead_type: 'buyer',
      source: 'apify_auto',
      score: lead.score,
      notes: `Auto-imported from LinkedIn\nHeadline: ${lead.headline}`,
      assigned_to: aum?.id
    }))

    // Check duplicates
    const urls = crmLeads.map(l => l.linkedin_url).filter(Boolean)
    const { data: existing } = await supabase
      .from('crm_leads')
      .select('linkedin_url')
      .in('linkedin_url', urls)

    const existingSet = new Set((existing || []).map(e => e.linkedin_url))
    const newLeads = crmLeads.filter(l => !existingSet.has(l.linkedin_url))

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
        leads: data.map(l => ({ name: l.name, company: l.company }))
      })
    }

    return res.status(200).json({
      success: true,
      imported: 0,
      skipped: crmLeads.length,
      message: 'All leads were duplicates'
    })
  } catch (error) {
    console.error('Daily leads error:', error)
    return res.status(500).json({
      success: false,
      error: error.message
    })
  }
}

function scoreProfile(profile) {
  let score = 0
  const text = ((profile.headline || '') + ' ' + (profile.summary || '')).toLowerCase()

  if (text.includes('acquisition') || text.includes('m&a')) score += 2
  if (text.includes('search fund') || text.includes('eir')) score += 3
  if (text.includes('investor') || text.includes('partner')) score += 1
  if (text.includes('ceo') || text.includes('founder')) score += 1
  if (profile.connectionsCount > 500) score += 1

  return Math.min(score, 5)
}
