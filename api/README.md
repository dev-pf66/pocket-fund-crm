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
- `stage` - Filter by stage (cold_outreach, warm_lead, active_conversation, client)
- `lead_type` - Filter by type (PE Firm, Family Office, Independent Sponsor)
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

**401 Unauthorized:**
```json
{
  "error": "Unauthorized. Provide valid x-api-key header."
}
```

**500 Server Error:**
```json
{
  "success": false,
  "error": "Error message here"
}
```

## Rate Limits

No rate limits currently enforced. Be respectful!

## Support

Issues? Contact the dev team or check the main README.
