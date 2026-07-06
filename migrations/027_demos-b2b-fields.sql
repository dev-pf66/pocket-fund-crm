-- ============================================
-- PE OS DEMOS — B2B sales context fields
-- ============================================
-- Captures the sales-context signal needed when selling PE OS to PE firms:
-- what they use today, when they'd decide, budget shape, integration
-- requirements, and any reasons they couldn't sign. These drive the kanban
-- card's urgency badges and the team's downstream sales review.

ALTER TABLE crm_demos
  ADD COLUMN IF NOT EXISTS current_tools TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE crm_demos
  ADD COLUMN IF NOT EXISTS decision_timeline VARCHAR(50)
  CHECK (decision_timeline IS NULL OR decision_timeline IN ('now', 'next_quarter', 'next_6mo', 'no_rush'));

ALTER TABLE crm_demos
  ADD COLUMN IF NOT EXISTS budget_signal VARCHAR(50)
  CHECK (budget_signal IS NULL OR budget_signal IN ('no_budget', 'small', 'mid', 'enterprise', 'unknown'));

ALTER TABLE crm_demos
  ADD COLUMN IF NOT EXISTS integrations_needed TEXT;

ALTER TABLE crm_demos
  ADD COLUMN IF NOT EXISTS objections TEXT;

ALTER TABLE crm_demos
  ADD COLUMN IF NOT EXISTS calendar_invite_url TEXT;
