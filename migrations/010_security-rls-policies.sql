-- ============================================
-- SUPABASE ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================
-- Run this in Supabase SQL Editor to secure your CRM
-- This ensures users can only access data they're authorized to see

-- ============================================
-- 1. ENABLE RLS ON ALL TABLES
-- ============================================

ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sample_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sample_deal_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_outreach_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activity_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_help_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_settings ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 2. PEOPLE TABLE POLICIES
-- ============================================

-- Authenticated users can view all team members
CREATE POLICY "authenticated_users_can_view_people" ON people
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Users can update their own record
CREATE POLICY "users_can_update_own_record" ON people
  FOR UPDATE
  USING (auth.uid()::text = email);

-- Allow creating new person records (for signup)
CREATE POLICY "allow_person_creation" ON people
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- 3. CRM LEADS POLICIES
-- ============================================

-- Authenticated users can view all leads (internal team access)
CREATE POLICY "team_can_view_leads" ON crm_leads
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Authenticated users can create leads
CREATE POLICY "team_can_create_leads" ON crm_leads
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Authenticated users can update leads
CREATE POLICY "team_can_update_leads" ON crm_leads
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Authenticated users can delete leads
CREATE POLICY "team_can_delete_leads" ON crm_leads
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- 4. LEAD ACTIVITIES POLICIES
-- ============================================

CREATE POLICY "team_can_view_activities" ON crm_lead_activities
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_create_activities" ON crm_lead_activities
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_update_activities" ON crm_lead_activities
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_delete_activities" ON crm_lead_activities
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- 5. SAMPLE DEALS POLICIES
-- ============================================

CREATE POLICY "team_can_view_sample_deals" ON crm_sample_deals
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_create_sample_deals" ON crm_sample_deals
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_update_sample_deals" ON crm_sample_deals
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_delete_sample_deals" ON crm_sample_deals
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- 6. SAMPLE DEAL SENDS POLICIES
-- ============================================

CREATE POLICY "team_can_view_sends" ON crm_sample_deal_sends
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_create_sends" ON crm_sample_deal_sends
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- 7. OUTREACH LOG POLICIES
-- ============================================

CREATE POLICY "team_can_view_outreach" ON crm_outreach_log
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_create_outreach" ON crm_outreach_log
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_update_outreach" ON crm_outreach_log
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_delete_outreach" ON crm_outreach_log
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- 8. ACTIVITY FEED POLICIES
-- ============================================

CREATE POLICY "team_can_view_activity_feed" ON crm_activity_feed
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_create_activity" ON crm_activity_feed
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- 9. HELP ARTICLES POLICIES
-- ============================================

-- Everyone can read published help articles
CREATE POLICY "team_can_view_help_articles" ON crm_help_articles
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only authenticated users can manage help articles
CREATE POLICY "team_can_create_help_articles" ON crm_help_articles
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_update_help_articles" ON crm_help_articles
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_delete_help_articles" ON crm_help_articles
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- 10. EMAIL TEMPLATES POLICIES
-- ============================================

CREATE POLICY "team_can_view_templates" ON crm_email_templates
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_create_templates" ON crm_email_templates
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_update_templates" ON crm_email_templates
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_delete_templates" ON crm_email_templates
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- 11. CRM SETTINGS POLICIES
-- ============================================

CREATE POLICY "team_can_view_settings" ON crm_settings
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "team_can_update_settings" ON crm_settings
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Run these to verify RLS is enabled:

-- Check which tables have RLS enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename LIKE 'crm_%' OR tablename = 'people';

-- View all policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
