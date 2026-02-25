# Multi-Source Lead Finder Setup (v2)

Automatically scrapes **LinkedIn + Crunchbase** daily for business buyers ($1-50M, acquisition intent) and imports them to your CRM.

## Why Two Sources?

**LinkedIn** → Find individuals (CEOs, investors, partners)
**Crunchbase** → Find firms + funded companies (PE firms, family offices, recently funded = capital to acquire)

**Better together** = Higher quality, more diversity

## Quick Setup (5 minutes)

### 1. Get Apify API Token
1. Go to https://apify.com/
2. Sign up (free tier: 5,000 results/month)
3. Go to Settings → Integrations → API Token
4. Copy your API token

### 2. Add Environment Variables to Vercel
Go to: https://vercel.com/devs-projects-4104f3bb/pocket-fund-crm/settings/environment-variables

Add these:
```
APIFY_API_TOKEN=apify_api_xxxxxxxxxxxxx
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
CRON_SECRET=your-random-secret-here
```

Get `SUPABASE_SERVICE_ROLE_KEY` from:
https://supabase.com/dashboard/project/lzydgdzjrgvqglxmyfjk/settings/api

For `CRON_SECRET`, generate a random string:
```bash
openssl rand -hex 32
```

### 3. Deploy
The cron job is already configured in `vercel.json`:
- Runs daily at 9:00 AM
- Endpoint: `/api/daily-leads`
- Finds 10 high-quality leads
- Auto-assigns to Aum

### 4. Test Manually
```bash
curl -X GET "https://pocket-fund-crm.vercel.app/api/daily-leads" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## How It Works

### Targeting Criteria
- **Job Titles:** CEO, Founder, Managing Partner, Investment Director, Principal, Investor
- **Industries:** Private Equity, VC, Investment Management, Family Office
- **Keywords:** acquisitions, M&A, buying businesses, search fund
- **Company Size:** 1-100 employees (signals $1-50M range)
- **Location:** USA-focused

### Quality Scoring (1-5)
- Mentions "acquisition" or "M&A": +2
- Has "search fund" or "entrepreneur in residence": +3
- Job title matches (CEO, Founder, Partner): +1
- Has "investor" in profile: +1
- 500+ connections: +1
- **Minimum score to import: 3**

### Daily Flow
```
9:00 AM (daily)
↓
Apify searches LinkedIn
↓
Finds ~15 profiles
↓
Scores & filters to best 10
↓
Checks for duplicates
↓
Imports new leads to CRM
↓
Assigns to Aum
↓
Sets stage: "new", source: "apify_auto"
```

## Monitoring

### Check Cron Logs
Vercel Dashboard → Deployments → Functions → `/api/daily-leads`

### Check Imported Leads
CRM → Pipeline → Filter by source: "apify_auto"

## Cost
- Apify Free Tier: 5,000 results/month
- 10 leads/day = 300/month = **$0** (free tier covers it)
- Premium tier if needed: $49/month for 50,000 results

## Customization

### Change Daily Lead Count
Edit `api/daily-leads.js`:
```javascript
maxResults: 15, // change this number
```

### Change Schedule
Edit `vercel.json`:
```json
"schedule": "0 9 * * *"  // "0 14 * * *" = 2pm daily
```

### Change Targeting
Edit `api/daily-leads.js` → modify `searchUrl` or add more search criteria

## Troubleshooting

**No leads importing?**
- Check Apify quota: https://console.apify.com/actors/runs
- Verify env vars in Vercel
- Check cron logs for errors

**Too many duplicates?**
- Broaden search criteria
- Add more search URLs

**Wrong quality leads?**
- Adjust `scoreProfile()` function
- Increase minimum score threshold

## Next Steps

Want to add more sources?
- Google Maps (local business owners)
- Twitter/X (indie hackers, founders)
- Crunchbase (funded startups)

Just lmk! 🚀

## What's New in V2?

### LinkedIn (6 leads/day max)
Same as before - finds individuals with acquisition intent

### Crunchbase (6 leads/day max) - NEW! 🎉

**Targets:**
- **PE Firms** - Active investors in the $1-50M range
- **Family Offices** - High net worth investors
- **Recently Funded Companies** - $1-50M funding = capital to acquire
- **Active Acquirers** - Companies with acquisition history

**Quality Signals:**
- Has made acquisitions before (+2 points)
- Recently raised funding (+1-2 points)
- Multiple funding rounds (+1 point)
- PE/Family Office type (+3 points)

**Data You Get:**
- Company name
- Website
- Description
- Funding amount
- Number of acquisitions
- Investor type

### Daily Mix: 10 Total Leads
- ~6 from LinkedIn (individuals)
- ~4 from Crunchbase (firms/companies)
- Both scored, sorted by quality
- Best 10 imported to CRM

## Updated Setup

Same as before, just need the Apify token. Crunchbase scraping is included automatically!

## Crunchbase Actor Info

Uses: `curious_coder/crunchbase-scraper`
- Free tier friendly
- Searches: investor type, funding range
- Returns: Company profiles with funding data

## Expected Quality Improvement

**Before (LinkedIn only):**
- 10 leads/day
- 60-70% quality
- Mostly individuals

**After (LinkedIn + Crunchbase):**
- 10 leads/day
- 70-80% quality ⬆️
- Mix of individuals + firms
- Better signal (funding data = intent)
- More diversity (not just LinkedIn)

## Monitoring

Check which source performs better:
```sql
SELECT source, COUNT(*), AVG(score)
FROM crm_leads
WHERE source IN ('linkedin_auto', 'crunchbase_auto')
GROUP BY source
```

Then adjust the ratio (edit `api/daily-leads-v2.js` lines with `.slice(0, 6)`)
