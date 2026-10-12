-- ============================================
-- MCP SESSIONS (who is actually at the keyboard)
-- ============================================
-- Several people share one Claude account (Dev's), so the OAuth token on the
-- claude.ai connector says whose ACCOUNT it is, not who is using it. Every MCP
-- conversation therefore starts by asking the human who they are and opening
-- a session for that person (api/_mcp-session.js). Every tool call carries the
-- session id; a session ends when they say so or after it sits idle, and the
-- next use has to ask again.
--
-- The person on the session is what CRM writes made through MCP are attributed
-- to (created_by / logged_by / stage-event changed_by), so this table is also
-- the audit trail of who used the connector, from which account, and when.
--
-- account_email: the OAuth login the token belongs to, or 'api-key'.
-- ended_reason:  user_ended | idle | archived
--
-- RLS on with NO policies: only the service role (the API) reads or writes.
-- Nothing in the app reads this yet.
--
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS crm_mcp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id INTEGER NOT NULL REFERENCES people(id),
  account_email TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  ended_reason TEXT,
  tool_calls INTEGER NOT NULL DEFAULT 0
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_mcp_sessions_ended_reason_check'
  ) THEN
    ALTER TABLE crm_mcp_sessions
      ADD CONSTRAINT crm_mcp_sessions_ended_reason_check
      CHECK (ended_reason IS NULL OR ended_reason IN ('user_ended', 'idle', 'archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_mcp_sessions_person_started
  ON crm_mcp_sessions (person_id, started_at DESC);

ALTER TABLE crm_mcp_sessions ENABLE ROW LEVEL SECURITY;
