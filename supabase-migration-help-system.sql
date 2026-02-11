-- Help System Migration
-- Editable help articles for CRM documentation

CREATE TABLE IF NOT EXISTS crm_help_articles (
  id SERIAL PRIMARY KEY,

  -- Article details
  title VARCHAR(200) NOT NULL,
  category VARCHAR(100) NOT NULL, -- 'getting_started', 'leads', 'outreach', 'team', 'analytics', 'settings'
  content TEXT NOT NULL,
  order_index INTEGER DEFAULT 0, -- For ordering within category

  -- Metadata
  is_published BOOLEAN DEFAULT true,
  last_updated_by INTEGER REFERENCES people(id),
  version INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_help_category ON crm_help_articles(category);
CREATE INDEX IF NOT EXISTS idx_help_published ON crm_help_articles(is_published);
CREATE INDEX IF NOT EXISTS idx_help_order ON crm_help_articles(category, order_index);

-- Full-text search
CREATE INDEX IF NOT EXISTS idx_help_search
ON crm_help_articles USING gin(to_tsvector('english', title || ' ' || content));

-- RLS
ALTER TABLE crm_help_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for published articles"
ON crm_help_articles FOR SELECT USING (is_published = true OR true);

CREATE POLICY "Allow all operations for authenticated users"
ON crm_help_articles FOR ALL USING (true) WITH CHECK (true);

-- Trigger
CREATE TRIGGER crm_help_articles_updated_at
  BEFORE UPDATE ON crm_help_articles
  FOR EACH ROW
  EXECUTE FUNCTION update_crm_updated_at();

-- Seed initial help articles
INSERT INTO crm_help_articles (title, category, content, order_index) VALUES

-- GETTING STARTED
('Welcome to PF Sales CRM', 'getting_started',
'# Welcome to PF Sales CRM

This CRM helps you track potential clients who might hire Pocket Fund''s services.

## Who Uses This
- **You (CEO)**: Monitor pipeline health, team performance, analytics
- **Aum (Head of Analysts)**: Research leads, score fit, assign to team
- **Anmol (Sales Intern)**: Execute outreach, hit 10/day goal

## Main Sections
- **Dashboard**: Overview, assigned leads, team activity
- **Pipeline**: Kanban board with all leads
- **Outreach Tracker**: Log daily outreach (goal: 10/day)
- **Analytics**: Conversion rates, outreach stats
- **Help**: This page!', 1),

('Quick Start Guide', 'getting_started',
'# Quick Start Guide

## Day 1: Add Your First Lead
1. Go to **Pipeline**
2. Click **+ Add Lead**
3. Fill in: Name, Firm, Email, Lead Type
4. Click **Save**

## Day 2: Score & Assign
1. Open the lead you added
2. Click **Edit**
3. Add **Fit Score** (1-5), **Industry**, **Firmographics**
4. **Assign To** a team member
5. Click **Save**

## Day 3: Start Outreach
1. Go to **Outreach Tracker**
2. Click **+ Log Outreach**
3. Select lead, type (email/LinkedIn/call)
4. Paste message you sent
5. Log 10 outreaches today!

## Day 4: Monitor Team
1. Check **Dashboard** → see team activity feed
2. Filter **Pipeline** → "My Leads" to focus
3. Review **Analytics** → conversion rates, reply rates', 2),

-- LEADS
('Adding & Managing Leads', 'leads',
'# Adding & Managing Leads

## How to Add a Lead
1. Click **+ Add Lead** button in Pipeline
2. Fill required fields:
   - **Name**: Contact person
   - **Firm**: Company name
   - **Lead Type**: PE Firm / Family Office / Independent Sponsor
3. Optional but recommended:
   - Email, Phone, LinkedIn URL
   - Deal Criteria (what they invest in)

## Lead Stages
- **Cold Outreach**: Just added, need to reach out
- **Warm Lead**: Responded positively
- **Active Conversation**: Actively discussing
- **Client**: Closed deal!

## Moving Leads Through Pipeline
- **Drag & drop** cards between columns
- Or open lead → Edit → change Stage', 1),

('Lead Scoring & Qualification', 'leads',
'# Lead Scoring & Qualification

## Fit Score (1-5)
Rate how good a prospect they are:
- **5/5** 🎯 Perfect fit - prioritize!
- **4/5** ✅ Good fit - strong prospect
- **3/5** 👌 Okay fit - maybe
- **2/5** ⚠️ Poor fit - low priority
- **1/5** ❌ Bad fit - probably pass

## Firmographics to Track
- **AUM**: Assets under management
- **Investment Thesis**: What they invest in
- **Portfolio Size**: # of companies
- **Fund Vintage**: Year established
- **Recent Deals**: Notable investments

## Decision Timeline
- **Expected Close Date**: When might they buy?
- **Budget Discussed**: Pricing range
- **Decision Process Stage**: Where in approval process?
- **Key Blockers**: What''s preventing close?

## Relationship Strength
- **Cold**: Never met
- **Warm**: Had conversation
- **Strong**: Trust established', 2),

('Lead Assignment', 'leads',
'# Lead Assignment

## How to Assign Leads
1. Open lead detail page
2. Click **Edit**
3. Find **Assigned To** dropdown
4. Select team member (Aum, Anmol, etc.)
5. Click **Save**

## Workflow
1. **Aum** researches leads → scores them
2. **Aum** assigns best fits (4-5 score) to **Anmol**
3. **Anmol** sees in "My Assigned Leads" on Dashboard
4. **Anmol** does outreach on assigned leads

## Filtering by Assignment
In Pipeline:
- **All Leads**: See everything
- **My Leads**: Only leads assigned to you
- **Unassigned**: Leads not assigned yet

Use "My Leads" filter to focus on your work!', 3),

('Tags & Organization', 'leads',
'# Tags & Organization

## Using Tags
Tags help categorize leads for quick filtering.

**Default Tags:**
- Met at Conference 🤝
- Warm Intro 👋
- High Priority 🔥
- Q1 Target 🎯
- Decision Maker 👔
- Budget Approved 💰
- Technical Evaluation 🔧
- Active Negotiation 💼

## How to Add Tags
1. Open lead detail page
2. Scroll to **Tags** section
3. Click any tag to add it
4. Click **×** on tag to remove it

## Future: Filter by Tags
Coming soon: Filter pipeline by tags!', 4),

-- OUTREACH
('Daily Outreach Tracking', 'outreach',
'# Daily Outreach Tracking

## Goal: 10 Outreaches Per Day

### What Counts as Outreach?
- ✅ Cold emails
- ✅ LinkedIn messages
- ✅ Phone calls
- ✅ Any other contact attempt

### How to Log Outreach
1. Go to **Outreach Tracker**
2. Click **+ Log Outreach**
3. Fill in:
   - **Lead name** (or select from dropdown)
   - **Type**: Email / LinkedIn / Call
   - **Fit Score**: How good is this prospect?
   - **Industry**: Their industry
   - **Message Content**: Copy/paste what you sent
   - **Platform Details**: Where you contacted them
4. Click **Log Outreach**

### Track Your Progress
- See **X/10** with progress bar at top
- Green when you hit goal!
- Build a streak! 🔥', 1),

('Bulk CSV Upload', 'outreach',
'# Bulk CSV Upload

## Upload Many Outreaches at Once

### How to Use CSV Upload
1. Click **CSV Upload** button
2. Select your CSV file
3. Auto-maps columns
4. Click **Upload**

### CSV Format
Required column: **lead_name**

Optional columns:
- firm_name
- type (cold_email, linkedin_message, phone_call)
- status (sent, replied, no_response)
- message_content
- platform_details
- fit_score (1-5)
- industry
- deal_size
- location
- lead_source
- notes
- date

### Example CSV
```
lead_name,firm_name,type,fit_score,industry,message_content
John Smith,Acme Capital,cold_email,5,SaaS,Hey John - loved your post...
Sarah J,Growth PE,linkedin_message,4,E-commerce,Hi Sarah - quick intro...
```

Download your sent emails/messages → format as CSV → bulk upload!', 2),

('Outreach Quality Tips', 'outreach',
'# Outreach Quality Tips

## What to Track
Always include:
1. **Message Content**: The actual text you sent
2. **Platform Details**: Where you messaged them
3. **Fit Score**: Rate the lead quality
4. **Industry**: Helps identify patterns

## Why This Matters
- See which messages get best reply rates
- Identify which industries respond well
- Track what platforms work best
- Improve your outreach over time

## Best Practices
- Log outreach immediately (don''t wait)
- Be honest with fit scores
- Copy full message content
- Note any personalization you did
- Track replies in status dropdown', 3),

-- TEAM
('Team Activity Feed', 'team',
'# Team Activity Feed

## Real-Time Team Visibility

See what everyone is working on in real-time!

### Where to Find It
**Dashboard** → right side → "Team Activity" widget

### What You''ll See
- "Anmol logged cold email to John Smith" - 2m ago
- "Aum assigned Sarah to Anmol" - 15m ago
- "You added new lead: Mike Chen" - 1h ago

### Activity Types
- 🆕 Lead created
- 👤 Lead assigned
- 📧 Outreach logged
- 📈 Stage changed
- ⭐ Lead qualified

### Auto-Updates
Feed refreshes every 30 seconds automatically!

### Why It''s Useful
- See who''s hitting outreach goals
- Know when leads are assigned to you
- Monitor team productivity
- Celebrate wins together 🎉', 1),

('My Assigned Leads', 'team',
'# My Assigned Leads

## Your Personal Work Queue

### Dashboard Widget
See count of leads assigned to you + list

### How It Works
1. Aum researches leads
2. Aum assigns best ones to you
3. You see notification on Dashboard
4. Click to view in Pipeline

### Pipeline Filter
Click **Filters** → **My Leads**
- Shows only leads assigned to you
- Focus on your work
- Ignore unrelated leads

### Perfect for Anmol
Sales intern focuses only on assigned leads:
- No distraction from other leads
- Clear daily priorities
- Track your personal pipeline', 2),

-- ANALYTICS
('Understanding Analytics', 'analytics',
'# Understanding Analytics

## Conversion Funnel
Shows how leads move through stages:
- Cold Outreach → Warm Lead (X% convert)
- Warm Lead → Active (Y% convert)
- Active → Client (Z% convert)
- **Overall Rate**: Cold → Client

### What''s Good?
- Cold to Warm: 30%+
- Warm to Active: 50%+
- Active to Client: 30%+
- Overall: 10%+

## Pipeline Velocity
Average days in each stage:
- Want to minimize time in each stage
- Track if leads getting stuck

## Lead Sources
Which sources convert best?
- LinkedIn, Referrals, Conferences, etc.
- Double down on best sources!

## Weekly Trends
Last 4 weeks performance:
- New leads added
- Moved to active
- Closed clients', 1),

('Outreach Analytics', 'analytics',
'# Outreach Analytics

## Daily Outreach Activity (Last 7 Days)

Track team outreach performance:
- Total outreaches per day
- Breakdown by type (email, LinkedIn, calls)
- Replies received
- Goal met indicator (✓ Met or X/10)

## Summary Stats
- **Total**: 7-day sum
- **Daily Average**: Avg per day
- **Days Hit Goal**: How many days hit 10+
- **Reply Rate**: % of outreaches that got replies

## What to Track
- Are you consistently hitting 10/day?
- Which outreach types get best reply rates?
- Which days of week are most productive?
- Is reply rate improving over time?

## Goals
- Hit 10 outreaches/day consistently
- Build streak (consecutive days with 10+)
- Improve reply rate above 10%
- Identify best outreach methods', 2);

-- Add last updated timestamp
CREATE OR REPLACE FUNCTION get_help_last_updated()
RETURNS TIMESTAMP WITH TIME ZONE AS $$
BEGIN
  RETURN (SELECT MAX(updated_at) FROM crm_help_articles);
END;
$$ LANGUAGE plpgsql;
