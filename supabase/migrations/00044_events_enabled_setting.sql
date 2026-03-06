-- ============================================================
-- 44. Add events_enabled setting to organizations
-- Default OFF — admins must opt-in to enable events
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS events_enabled BOOLEAN NOT NULL DEFAULT FALSE;
