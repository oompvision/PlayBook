-- ============================================================================
-- SOC II Compliance: Audit Logging
-- Creates the audit_logs table for tracking all sensitive data access and
-- modifications across the platform.
-- ============================================================================

-- Audit action enum
CREATE TYPE public.audit_action AS ENUM (
  'create',
  'read',
  'update',
  'delete',
  'login',
  'login_failed',
  'logout',
  'export'
);

-- Main audit_logs table
CREATE TABLE public.audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action        public.audit_action NOT NULL,
  resource_type text NOT NULL,                -- e.g. 'booking', 'profile', 'payment'
  resource_id   text,                         -- ID of the affected resource
  old_value     jsonb,                        -- previous state (for updates/deletes)
  new_value     jsonb,                        -- new state (for creates/updates)
  ip_address    inet,                         -- client IP
  user_agent    text,                         -- client user-agent
  metadata      jsonb DEFAULT '{}'::jsonb,    -- additional context
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX idx_audit_logs_org_created ON public.audit_logs (org_id, created_at DESC);
CREATE INDEX idx_audit_logs_user_created ON public.audit_logs (user_id, created_at DESC);
CREATE INDEX idx_audit_logs_resource ON public.audit_logs (resource_type, resource_id);
CREATE INDEX idx_audit_logs_action ON public.audit_logs (action, created_at DESC);

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies:
-- Super admins can read all logs
CREATE POLICY "audit_logs_super_admin_read"
  ON public.audit_logs FOR SELECT
  USING (public.is_super_admin());

-- Org admins can read their org's logs
CREATE POLICY "audit_logs_org_admin_read"
  ON public.audit_logs FOR SELECT
  USING (public.is_org_admin(org_id));

-- Service role can insert (bypasses RLS)
-- Application-level inserts use the service client which bypasses RLS
-- No user should be able to insert, update, or delete audit logs directly

-- No UPDATE or DELETE policies — audit logs are immutable
-- Only the service role (used by triggers and application code) can write

-- Comment: SOC II requires minimum 90-day retention for audit logs.
-- Configure Supabase pg_cron or external process to purge logs older than 1 year.
