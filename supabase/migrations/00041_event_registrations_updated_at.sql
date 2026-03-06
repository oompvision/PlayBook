-- ============================================================
-- 41. Add updated_at column to event_registrations
-- The register_for_event RPC uses ON CONFLICT ... DO UPDATE,
-- which triggers update_updated_at_column() — but the column
-- was missing from the original table definition (migration 38).
-- ============================================================

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TRIGGER set_event_registrations_updated_at
  BEFORE UPDATE ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
