-- ============================================================
-- 60. Add events_only scheduling type
-- Orgs with events_only skip all slot/schedule config.
-- Admins only manage events; customers only register for events.
-- ============================================================

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_scheduling_type_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_scheduling_type_check
  CHECK (scheduling_type IN ('slot_based', 'dynamic', 'events_only'));
