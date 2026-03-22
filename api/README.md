# Pocket Fund CRM — API Reference

**Base URL:** `https://pocket-fund-crm.vercel.app`

All endpoints are Vercel Serverless Functions. CORS is enabled (`*`).

---

## Authentication

Every request must include your API key via **one** of:

| Method | Format |
|--------|--------|
| Header (preferred) | `x-api-key: YOUR_KEY` |
| Query param | `?api_key=YOUR_KEY` |

The key is stored in the `CRM_API_KEY` Vercel environment variable.

**401 Response** (missing or invalid key):
```json
{ "error": "Unauthorized. Provide valid x-api-key header." }
```

> **Cron endpoints** (`daily-leads`, `daily-leads-v2`) use `Authorization: Bearer CRON_SECRET` instead — they are triggered automatically by Vercel Cron and are not meant for manual use.

---

## Endpoints Overview

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | [`/api/leads`](#get-apileads) | API key | List leads (filterable) |
| `GET` | [`/api/leads?id=`](#get-apileadsid123) | API key | Get single lead by ID |
| `POST` | [`/api/leads`](#post-apileads) | API key | Create a new lead |
| `GET` | [`/api/activities`](#get-apiactivities) | API key | List lead activities |
| `GET` | [`/api/analytics`](#get-apianalytics) | API key | Pipeline analytics & conversion rates |
| `POST` | [`/api/analyze-transcript`](#post-apianalyze-transcript) | API key | AI analysis of a sales call transcript |
| `POST` | [`/api/enrich-linkedin`](#post-apienrich-linkedin) | API key | AI-powered LinkedIn profile enrichment |
| `GET` | [`/api/investors`](#get-apiinvestors) | API key | List investors (filterable + searchable) |
| `GET` | [`/api/investors?id=`](#get-apiinvestorsid123) | API key | Get single investor by ID |
| `POST` | [`/api/investors`](#post-apiinvestors) | API key | Create a new investor |
| `GET` | `/api/daily-leads` | Cron secret | Auto-import leads from LinkedIn (v1) |
| `GET` | `/api/daily-leads-v2` | Cron secret | Auto-import from LinkedIn + Crunchbase (v2) |

---

## Leads

### GET /api/leads

List leads with optional filters. Returns newest first.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `stage` | string | — | Filter by pipeline stage |
| `lead_type` | string | — | Filter by lead type |
| `limit` | integer | `100` | Max results to return |

**Example:**
```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://pocket-fund-crm.vercel.app/api/leads?stage=warm_lead&lead_type=PE%20Firm&limit=10"
```

**200 Response:**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": 33,
      "name": "Nemanja",
      "firm_name": "",
      "email": "nitroy2k@gmail.com",
      "phone": "",
      "linkedin_url": "",
      "lead_type": "Other",
      "deal_criteria": "",
      "stage": "warm_lead",
      "last_activity_date": "2026-03-11T13:52:09.477+00:00",
      "last_activity_type": "note",
      "next_follow_up_date": null,
      "reach_out_later_date": null,
      "needs_sample_deals": false,
      "notes": "seller + buyer",
      "initial_conversation": null,
      "created_by": 1,
      "created_at": "2026-03-11T13:52:09.404447+00:00",
      "updated_at": "2026-03-11T13:52:09.870573+00:00",
      "lead_source": "Referral",
      "lead_score": 47,
      "score_last_calculated": "2026-03-11T13:52:09.644262+00:00",
      "aum": null,
      "investment_thesis": null,
      "portfolio_size": null,
      "fund_vintage": null,
      "recent_deals": null,
      "expected_close_date": null,
      "budget_discussed": null,
      "key_blockers": null,
      "decision_process_stage": null,
      "relationship_strength": "cold",
      "mutual_connections": null,
      "referral_details": null,
      "trust_level": null,
      "current_position": null,
      "past_experience": null,
      "education": null,
      "linkedin_headline": null,
      "enrichment_status": null,
      "enriched_at": null,
      "assigned_to": null,
      "assigned_by": null,
      "assigned_date": null
    }
  ]
}
```

---

### GET /api/leads?id=123

Fetch a single lead by its database ID.

**Example:**
```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://pocket-fund-crm.vercel.app/api/leads?id=1"
```

**200 Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Underdogs",
    "firm_name": "",
    "stage": "warm_lead",
    "lead_type": null,
    "created_at": "2026-02-10T19:36:53.336404+00:00",
    ...
  }
}
```

**404 Response** (ID doesn't exist):
```json
{ "success": false, "error": "Lead not found" }
```

---

### POST /api/leads

Create a new lead. Returns the full created lead object.

**Headers:**
```
x-api-key: YOUR_KEY
Content-Type: application/json
```

**Request Body:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | **Yes** | Lead name (cannot be empty) |
| `email` | string | No | |
| `phone` | string | No | |
| `firm_name` | string | No | |
| `linkedin_url` | string | No | |
| `lead_type` | string | No | See [Lead Type enum](#lead-type) |
| `lead_source` | string | No | See [Lead Source enum](#lead-source) |
| `stage` | string | No | See [Stage enum](#stage). Defaults to `new_lead` |
| `deal_criteria` | string | No | e.g. `"B2B SaaS, $1-5M revenue"` |
| `notes` | string | No | |
| `initial_conversation` | string | No | |
| `needs_sample_deals` | boolean | No | Defaults to `false` |
| `next_follow_up_date` | string | No | ISO date (`YYYY-MM-DD`) |
| `reach_out_later_date` | string | No | ISO date (`YYYY-MM-DD`) |
| `aum` | string | No | Assets under management |
| `investment_thesis` | string | No | |
| `portfolio_size` | number | No | |
| `fund_vintage` | string | No | |

> Fields not in this list (e.g. `id`, `created_at`, `lead_score`, `last_activity_date`) are ignored — they are system-managed.

**Example:**
```bash
curl -X POST \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "email": "jane@acmecap.com",
    "firm_name": "Acme Capital",
    "lead_type": "PE Firm",
    "lead_source": "LinkedIn",
    "stage": "warm_lead",
    "deal_criteria": "B2B SaaS, $2-10M revenue",
    "notes": "Met at PE conference, interested in deal flow"
  }' \
  "https://pocket-fund-crm.vercel.app/api/leads"
```

**201 Response:**
```json
{
  "success": true,
  "data": {
    "id": 34,
    "name": "Jane Smith",
    "email": "jane@acmecap.com",
    "firm_name": "Acme Capital",
    "lead_type": "PE Firm",
    "lead_source": "LinkedIn",
    "stage": "warm_lead",
    "deal_criteria": "B2B SaaS, $2-10M revenue",
    "notes": "Met at PE conference, interested in deal flow",
    "needs_sample_deals": false,
    "lead_score": 0,
    "created_at": "2026-03-12T12:46:06.152692+00:00",
    ...
  }
}
```

**400 Response** (missing name):
```json
{ "success": false, "error": "name is required" }
```

**400 Response** (invalid enum):
```json
{ "success": false, "error": "Invalid stage. Must be one of: new_lead, cold_outreach, warm_lead, active_conversation, client, passed" }
```

---

## Activities

### GET /api/activities

List lead activities (calls, emails, meetings, etc.) with optional filters. Returns newest first. Includes joined lead data (`name`, `firm_name`, `stage`).

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `lead_id` | integer | — | Filter to a specific lead's activities |
| `activity_type` | string | — | Filter by type (see [Activity Type enum](#activity-type)) |
| `limit` | integer | `50` | Max results to return |

**Example:**
```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://pocket-fund-crm.vercel.app/api/activities?lead_id=32&limit=5"
```

**200 Response:**
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": 45,
      "lead_id": 32,
      "activity_type": "note",
      "activity_date": "2026-02-28T06:57:49.525+00:00",
      "notes": "Had discovery call, interested in B2B SaaS deals",
      "sample_deals_sent": null,
      "logged_by": 2,
      "created_at": "2026-02-28T06:57:49.600+00:00",
      "lead": {
        "name": "Brendan",
        "firm_name": "saas.group",
        "stage": "active_conversation"
      }
    }
  ]
}
```

---

## Analytics

### GET /api/analytics

Pipeline analytics computed in real-time across all leads. Returns stage counts, stage-to-stage conversion rates, and per-source breakdown sorted by best conversion rate.

**Example:**
```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://pocket-fund-crm.vercel.app/api/analytics"
```

**200 Response:**
```json
{
  "success": true,
  "data": {
    "total_leads": 34,
    "conversion": {
      "cold_outreach": 12,
      "warm_lead": 10,
      "active_conversation": 8,
      "client": 4,
      "cold_to_warm_rate": 83,
      "warm_to_active_rate": 80,
      "active_to_client_rate": 50,
      "overall_rate": 33
    },
    "sources": [
      {
        "source": "Referral",
        "total": 8,
        "clients": 3,
        "conversion_rate": 37
      },
      {
        "source": "LinkedIn",
        "total": 15,
        "clients": 1,
        "conversion_rate": 6
      },
      {
        "source": "Unknown",
        "total": 11,
        "clients": 0,
        "conversion_rate": 0
      }
    ],
    "generated_at": "2026-03-12T12:50:00.000Z"
  }
}
```

**Fields explained:**

| Field | Description |
|-------|-------------|
| `conversion.cold_to_warm_rate` | % of cold outreach leads that became warm leads |
| `conversion.warm_to_active_rate` | % of warm leads that became active conversations |
| `conversion.active_to_client_rate` | % of active conversations that became clients |
| `conversion.overall_rate` | % of cold outreach leads that became clients (full funnel) |
| `sources[].conversion_rate` | % of leads from that source that became clients |

---

## Transcript Analysis

### POST /api/analyze-transcript

Send a sales call transcript for AI analysis. Uses Claude Haiku to generate a summary, sentiment, fit score, and next step. Saves the analysis to the `crm_transcripts` table.

**Headers:**
```
x-api-key: YOUR_KEY
Content-Type: application/json
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transcript_id` | integer | **Yes** | ID of the transcript record in `crm_transcripts` |
| `transcript_text` | string | **Yes** | Full text of the call transcript |

**Example:**
```bash
curl -X POST \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "transcript_id": 5,
    "transcript_text": "Dev: Thanks for hopping on. Tell me about what you're looking for in deal flow..."
  }' \
  "https://pocket-fund-crm.vercel.app/api/analyze-transcript"
```

**200 Response:**
```json
{
  "success": true,
  "analysis": {
    "summary": "Discovery call with potential PE client interested in B2B SaaS acquisitions in the $2-5M range.",
    "sentiment": "Positive",
    "fit_score": 4,
    "fit_reasoning": "Strong alignment on deal size and sector focus with clear intent to buy.",
    "next_step": "Send 2-3 sample deal teasers matching their B2B SaaS criteria.",
    "analysed_at": "2026-03-12T12:55:00.000Z"
  }
}
```

**Analysis fields:**

| Field | Type | Values |
|-------|------|--------|
| `summary` | string | 2-3 sentence recap |
| `sentiment` | string | `Positive`, `Neutral`, `Negative` |
| `fit_score` | integer | `1` (poor fit) to `5` (perfect fit) |
| `fit_reasoning` | string | One sentence explaining the score |
| `next_step` | string | Single most important action |

**400 Response:**
```json
{ "error": "transcript_id and transcript_text are required" }
```

---

## LinkedIn Enrichment

### POST /api/enrich-linkedin

Enrich a lead's profile using AI-powered LinkedIn analysis. Uses Claude Haiku to generate structured professional data (headline, position, experience, education) based on the lead's existing info and LinkedIn URL. Updates the lead record and logs an activity note.

**Headers:**
```
x-api-key: YOUR_KEY
Content-Type: application/json
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `leadId` | integer | **Yes** | ID of the lead to enrich |
| `linkedinUrl` | string | **Yes** | Full LinkedIn profile URL (must be a valid `linkedin.com` domain) |

**Example:**
```bash
curl -X POST \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "leadId": 32,
    "linkedinUrl": "https://www.linkedin.com/in/janesmith"
  }' \
  "https://pocket-fund-crm.vercel.app/api/enrich-linkedin"
```

**200 Response:**
```json
{
  "success": true,
  "enrichment": {
    "linkedin_url": "https://www.linkedin.com/in/janesmith",
    "linkedin_headline": "Managing Partner at Acme Capital | Private Equity | B2B SaaS Acquisitions",
    "current_position": "Managing Partner at Acme Capital",
    "past_experience": "• VP of Strategy at Summit Partners (2018-2022)\n• Associate at Goldman Sachs (2015-2018)",
    "education": "MBA, Wharton School of Business; BS Finance, NYU",
    "enrichment_status": "enriched",
    "enriched_at": "2026-03-16T14:30:00.000Z",
    "enrichment_notes": "Experienced PE professional with B2B SaaS focus. Approach with relevant deal flow in the $2-10M range."
  }
}
```

**Enrichment fields saved to the lead:**

| Field | Type | Description |
|-------|------|-------------|
| `linkedin_url` | string | The LinkedIn URL provided |
| `linkedin_headline` | string | Generated headline (max 300 chars) |
| `current_position` | string | Current role and title (max 200 chars) |
| `past_experience` | string | Bullet-pointed past roles |
| `education` | string | Educational background |
| `enrichment_status` | string | Set to `enriched` on success, `failed` on error |
| `enriched_at` | timestamp | When enrichment completed |

**Side effects:**
- Sets `enrichment_status` to `enriching` during processing
- Logs a `note` activity on the lead with enrichment summary
- On failure, sets `enrichment_status` to `failed`

**400 Response:**
```json
{ "error": "leadId and linkedinUrl are required" }
```

**400 Response** (invalid URL):
```json
{ "error": "Invalid LinkedIn URL" }
```

**404 Response:**
```json
{ "error": "Lead not found" }
```

---

## Investors

### GET /api/investors

List investors with optional filters and search. Returns newest-updated first.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | — | Filter by investor status |
| `investor_type` | string | — | Filter by investor type |
| `search` | string | — | Search across name, firm, and email (case-insensitive) |
| `limit` | integer | `100` | Max results to return |

**Example:**
```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://pocket-fund-crm.vercel.app/api/investors?status=committed&investor_type=Family%20Office&limit=10"
```

**200 Response:**
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": 5,
      "name": "Sarah Chen",
      "firm": "Chen Family Office",
      "email": "sarah@chenfamilyoffice.com",
      "phone": "+1 (415) 555-0199",
      "linkedin_url": "https://linkedin.com/in/sarahchen",
      "investor_type": "Family Office",
      "status": "committed",
      "check_size_min": 50000,
      "check_size_max": 250000,
      "investment_focus": "SMB SaaS, healthcare services",
      "notes": "Prefers co-investments with other family offices",
      "created_by": 1,
      "created_at": "2026-03-10T08:30:00.000Z",
      "updated_at": "2026-03-15T14:20:00.000Z"
    }
  ]
}
```

---

### GET /api/investors?id=123

Fetch a single investor by their database ID.

**Example:**
```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://pocket-fund-crm.vercel.app/api/investors?id=5"
```

**200 Response:**
```json
{
  "success": true,
  "data": {
    "id": 5,
    "name": "Sarah Chen",
    "firm": "Chen Family Office",
    "status": "committed",
    "investor_type": "Family Office",
    ...
  }
}
```

**404 Response:**
```json
{ "success": false, "error": "Investor not found" }
```

---

### POST /api/investors

Create a new investor. Returns the full created investor object.

**Headers:**
```
x-api-key: YOUR_KEY
Content-Type: application/json
```

**Request Body:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | **Yes** | Investor name (cannot be empty) |
| `firm` | string | No | Fund or office name |
| `email` | string | No | |
| `phone` | string | No | |
| `linkedin_url` | string | No | LinkedIn profile URL |
| `investor_type` | string | No | See [Investor Type enum](#investor-type). Defaults to `Individual LP` |
| `status` | string | No | See [Investor Status enum](#investor-status). Defaults to `prospect` |
| `check_size_min` | number | No | Minimum check size in dollars |
| `check_size_max` | number | No | Maximum check size in dollars |
| `investment_focus` | string | No | e.g. `"SMB SaaS, services, healthcare"` |
| `notes` | string | No | Context, intro source, preferences |

**Example:**
```bash
curl -X POST \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sarah Chen",
    "firm": "Chen Family Office",
    "email": "sarah@chenfamilyoffice.com",
    "investor_type": "Family Office",
    "status": "prospect",
    "check_size_min": 50000,
    "check_size_max": 250000,
    "investment_focus": "SMB SaaS, healthcare services",
    "notes": "Intro via Mike at Apex Partners"
  }' \
  "https://pocket-fund-crm.vercel.app/api/investors"
```

**201 Response:**
```json
{
  "success": true,
  "data": {
    "id": 6,
    "name": "Sarah Chen",
    "firm": "Chen Family Office",
    "email": "sarah@chenfamilyoffice.com",
    "investor_type": "Family Office",
    "status": "prospect",
    "check_size_min": 50000,
    "check_size_max": 250000,
    "investment_focus": "SMB SaaS, healthcare services",
    "notes": "Intro via Mike at Apex Partners",
    "created_at": "2026-03-16T10:00:00.000Z",
    "updated_at": "2026-03-16T10:00:00.000Z",
    ...
  }
}
```

**400 Response** (missing name):
```json
{ "success": false, "error": "name is required" }
```

**400 Response** (invalid enum):
```json
{ "success": false, "error": "Invalid investor_type. Must be one of: Individual LP, Family Office, Fund of Funds, Institutional, HNW Individual, Strategic, Other" }
```

---

## Cron Jobs (Internal)

These are triggered automatically by Vercel Cron. They use `Authorization: Bearer CRON_SECRET`, not the API key.

### GET /api/daily-leads-v2

**Schedule:** Daily at 9:00 AM UTC (`0 9 * * *`)

Scrapes LinkedIn (and eventually Crunchbase) for potential business buyers, scores them, deduplicates against existing leads, and imports the top 10 into the CRM.

**Scoring criteria:** Profiles mentioning "acquisition", "M&A", "search fund", or "EIR" score highest (max 5). Profiles with 500+ connections get a bonus.

**200 Response:**
```json
{
  "success": true,
  "imported": 3,
  "skipped": 7,
  "breakdown": { "linkedin": 8, "crunchbase": 0 },
  "leads": [
    { "name": "Alex Chen", "company": "Pacific Equity", "source": "linkedin_auto" }
  ]
}
```

### GET /api/daily-leads

Legacy v1 scraper (LinkedIn only). Superseded by `daily-leads-v2` but still functional.

---

## Enum Values

### Stage

Pipeline stages a lead progresses through:

| Value | Description |
|-------|-------------|
| `new_lead` | Freshly added, not yet contacted |
| `cold_outreach` | Initial contact, no response yet |
| `warm_lead` | Responded or showed interest |
| `active_conversation` | Ongoing discussions |
| `client` | Converted to paying client |
| `passed` | Lead declined or disqualified |

### Lead Type

| Value |
|-------|
| `Independent Sponsor` |
| `PE Firm` |
| `Family Office` |
| `Other` |

### Lead Source

| Value |
|-------|
| `LinkedIn` |
| `Referral` |
| `Cold Email` |
| `Event` |
| `Website` |

### Investor Type

| Value |
|-------|
| `Individual LP` |
| `Family Office` |
| `Fund of Funds` |
| `Institutional` |
| `HNW Individual` |
| `Strategic` |
| `Other` |

### Investor Status

| Value | Description |
|-------|-------------|
| `prospect` | Identified, not yet contacted (default) |
| `contacted` | Initial outreach made |
| `in_conversation` | Active discussions |
| `committed` | Verbal or written commitment |
| `invested` | Capital received |
| `passed` | Declined or disqualified |

### Activity Type

Used in the `crm_lead_activities` table:

| Value |
|-------|
| `call` |
| `email` |
| `linkedin_message` |
| `meeting` |
| `sample_sent` |
| `proposal_sent` |
| `note` |

---

## Lead Object Schema

Full field reference for the `crm_leads` table:

| Field | Type | Set via API | Description |
|-------|------|-------------|-------------|
| `id` | integer | Auto | Primary key |
| `name` | string | POST | Lead name |
| `firm_name` | string | POST | Company/firm |
| `email` | string | POST | Email address |
| `phone` | string | POST | Phone number |
| `linkedin_url` | string | POST | LinkedIn profile URL |
| `lead_type` | string | POST | See [Lead Type enum](#lead-type) |
| `deal_criteria` | string | POST | What they're looking for |
| `stage` | string | POST | See [Stage enum](#stage) |
| `lead_source` | string | POST | See [Lead Source enum](#lead-source) |
| `notes` | string | POST | General notes |
| `initial_conversation` | string | POST | First conversation notes |
| `needs_sample_deals` | boolean | POST | Whether they need sample deals |
| `next_follow_up_date` | date | POST | Next scheduled follow-up |
| `reach_out_later_date` | date | POST | Deferred outreach date |
| `aum` | string | POST | Assets under management |
| `investment_thesis` | string | POST | Their investment thesis |
| `portfolio_size` | number | POST | Number of portfolio companies |
| `fund_vintage` | string | POST | Fund vintage year |
| `last_activity_date` | timestamp | System | Auto-updated by activities |
| `last_activity_type` | string | System | Auto-updated by activities |
| `lead_score` | integer | System | Calculated lead score (0-100) |
| `score_last_calculated` | timestamp | System | When score was last computed |
| `relationship_strength` | string | System | `cold`, `warm`, `strong` |
| `created_by` | integer | System | User who created the lead |
| `created_at` | timestamp | System | Creation timestamp |
| `updated_at` | timestamp | System | Last update timestamp |
| `enrichment_status` | string | System | Data enrichment status |
| `enriched_at` | timestamp | System | When enrichment last ran |
| `assigned_to` | integer | System | Assigned team member |
| `assigned_by` | integer | System | Who assigned the lead |
| `assigned_date` | timestamp | System | When lead was assigned |

---

## Error Reference

| Status | Meaning | Example |
|--------|---------|---------|
| `200` | Success | `{ "success": true, "data": ... }` |
| `201` | Created (POST) | `{ "success": true, "data": ... }` |
| `400` | Bad request | `{ "success": false, "error": "name is required" }` |
| `401` | Invalid API key | `{ "error": "Unauthorized. Provide valid x-api-key header." }` |
| `404` | Not found | `{ "success": false, "error": "Lead not found" }` |
| `405` | Wrong HTTP method | `{ "error": "Method not allowed. Use GET or POST." }` |
| `500` | Server error | `{ "success": false, "error": "..." }` |

---

## Environment Variables

Required in Vercel project settings:

| Variable | Used By | Description |
|----------|---------|-------------|
| `CRM_API_KEY` | leads, activities, analytics, analyze-transcript, enrich-linkedin, investors | API key for external access |
| `VITE_SUPABASE_URL` | All endpoints | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | leads, activities, analytics, investors, daily-leads, daily-leads-v2 | Supabase service role key (server-side) |
| `VITE_SUPABASE_ANON_KEY` | analyze-transcript, frontend | Supabase anon key |
| `ANTHROPIC_API_KEY` | analyze-transcript, enrich-linkedin | Claude API key for AI analysis |
| `APIFY_API_TOKEN` | daily-leads, daily-leads-v2 | Apify token for LinkedIn scraping |
| `CRON_SECRET` | daily-leads, daily-leads-v2 | Vercel Cron auth secret |

---

## Rate Limits

No rate limits currently enforced.
