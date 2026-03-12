# PF Sales CRM API

API endpoints for clawdbot and external integrations.

## Authentication

All API endpoints require an API key passed via:
- Header: `x-api-key: your-api-key`
- OR Query param: `?api_key=your-api-key`

Set your API key in Vercel environment variables as `CRM_API_KEY`.

## Endpoints

### GET /api/leads
Get all leads with optional filtering.

**Query Parameters:**
- `stage` - Filter by stage (`cold_outreach`, `warm_lead`, `active_conversation`, `client`, `passed`)
- `lead_type` - Filter by type (`Independent Sponsor`, `PE Firm`, `Family Office`, `Other`)
- `limit` - Max results (default: 100)

**Example:**
```bash
curl -H "x-api-key: your-key" \
  "https://pocket-fund-crm.vercel.app/api/leads?stage=active_conversation&limit=10"
```

**Response:**
```json
{
  "success": true,
  "count": 10,
  "data": [
    {
      "id": 1,
      "name": "John Smith",
      "firm_name": "Acme Capital",
      "email": "john@acme.com",
      "stage": "active_conversation",
      "lead_type": "PE Firm",
      "created_at": "2026-02-10T12:00:00Z",
      ...
    }
  ]
}
```

### GET /api/leads?id=

Fetch a single lead by ID.

**Example:**
```bash
curl -H "x-api-key: your-key" \
  "https://pocket-fund-crm.vercel.app/api/leads?id=123"
```

**200 Response:**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "name": "John Smith",
    "firm_name": "Acme Capital",
    "stage": "warm_lead",
    ...
  }
}
```

**404 Response:**
```json
{ "success": false, "error": "Lead not found" }
```

### POST /api/leads

Create a new lead.

**Required:** `name` (string)

**Optional fields:**

| Field | Type | Notes |
|-------|------|-------|
| `email` | string | |
| `phone` | string | |
| `firm_name` | string | |
| `linkedin_url` | string | |
| `lead_type` | string | `Independent Sponsor`, `PE Firm`, `Family Office`, `Other` |
| `lead_source` | string | `LinkedIn`, `Referral`, `Cold Email`, `Event`, `Website` |
| `stage` | string | `cold_outreach`, `warm_lead`, `active_conversation`, `client`, `passed` |
| `deal_criteria` | string | |
| `notes` | string | |
| `initial_conversation` | string | |
| `needs_sample_deals` | boolean | |
| `next_follow_up_date` | string | ISO date |
| `reach_out_later_date` | string | ISO date |
| `aum` | string | |
| `investment_thesis` | string | |
| `portfolio_size` | number | |
| `fund_vintage` | string | |

**Example:**
```bash
curl -X POST \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "Jane Smith", "firm_name": "Acme Capital", "lead_type": "PE Firm", "stage": "warm_lead"}' \
  "https://pocket-fund-crm.vercel.app/api/leads"
```

**201 Response:**
```json
{ "success": true, "data": { "id": 456, "name": "Jane Smith", ... } }
```

**400 Response (missing name):**
```json
{ "success": false, "error": "name is required" }
```

**400 Response (invalid enum):**
```json
{ "success": false, "error": "Invalid stage. Must be one of: cold_outreach, warm_lead, active_conversation, client, passed" }
```

### GET /api/analytics
Get CRM analytics and metrics.

**Example:**
```bash
curl -H "x-api-key: your-key" \
  "https://pocket-fund-crm.vercel.app/api/analytics"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total_leads": 150,
    "conversion": {
      "cold_outreach": 80,
      "warm_lead": 40,
      "active_conversation": 20,
      "client": 10,
      "cold_to_warm_rate": 50,
      "warm_to_active_rate": 50,
      "active_to_client_rate": 50,
      "overall_rate": 12
    },
    "sources": [
      {
        "source": "LinkedIn",
        "total": 50,
        "clients": 8,
        "conversion_rate": 16
      }
    ],
    "generated_at": "2026-02-11T14:30:00Z"
  }
}
```

### GET /api/activities
Get recent activities across all leads.

**Query Parameters:**
- `lead_id` - Filter by specific lead
- `activity_type` - Filter by type (call, email, linkedin_message, meeting, etc.)
- `limit` - Max results (default: 50)

**Example:**
```bash
curl -H "x-api-key: your-key" \
  "https://pocket-fund-crm.vercel.app/api/activities?activity_type=call&limit=20"
```

**Response:**
```json
{
  "success": true,
  "count": 20,
  "data": [
    {
      "id": 45,
      "lead_id": 12,
      "activity_type": "call",
      "activity_date": "2026-02-11T10:00:00Z",
      "notes": "Had discovery call, interested in B2B SaaS deals",
      "lead": {
        "name": "Sarah Johnson",
        "firm_name": "Growth Partners",
        "stage": "active_conversation"
      }
    }
  ]
}
```

## Error Responses

**400 Bad Request:**
```json
{ "success": false, "error": "name is required" }
```

**401 Unauthorized:**
```json
{ "error": "Unauthorized. Provide valid x-api-key header." }
```

**404 Not Found:**
```json
{ "success": false, "error": "Lead not found" }
```

**405 Method Not Allowed:**
```json
{ "error": "Method not allowed. Use GET or POST." }
```

**500 Server Error:**
```json
{ "success": false, "error": "Error message here" }
```

## Rate Limits

No rate limits currently enforced. Be respectful!

## Support

Issues? Contact the dev team or check the main README.
