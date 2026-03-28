-- ============================================================
-- 56. Event Calendar Enhancements
-- - Add FK constraint on events.template_id → event_templates
-- - New table: event_day_schedules (save a day's event lineup)
-- - New table: event_day_schedule_entries (entries in a day schedule)
-- ============================================================

-- ============================================================
-- 56a. Add FK constraint on events.template_id
-- The column already exists (migration 00038) but has no FK.
-- ============================================================

ALTER TABLE public.events
  ADD CONSTRAINT fk_events_template_id
  FOREIGN KEY (template_id) REFERENCES public.event_templates(id) ON DELETE SET NULL;

-- ============================================================
-- 56b. event_day_schedules — a saved "day lineup" of event templates
-- ============================================================

CREATE TABLE IF NOT EXISTS public.event_day_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_day_schedules_org
  ON public.event_day_schedules (org_id);

CREATE TRIGGER set_event_day_schedules_updated_at
  BEFORE UPDATE ON public.event_day_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.event_day_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_day_schedules_admin_all"
  ON public.event_day_schedules FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

CREATE POLICY "event_day_schedules_super_admin_all"
  ON public.event_day_schedules FOR ALL
  USING (public.is_super_admin());

-- ============================================================
-- 56c. event_day_schedule_entries — individual entries in a day schedule
-- Each entry references an event template + optional bay overrides
-- ============================================================

CREATE TABLE IF NOT EXISTS public.event_day_schedule_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_schedule_id UUID NOT NULL REFERENCES public.event_day_schedules(id) ON DELETE CASCADE,
  event_template_id UUID NOT NULL REFERENCES public.event_templates(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  bay_id_overrides UUID[] DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_day_schedule_entries_schedule
  ON public.event_day_schedule_entries (day_schedule_id);

-- RLS (inherits from parent via join)
ALTER TABLE public.event_day_schedule_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_day_schedule_entries_admin_all"
  ON public.event_day_schedule_entries FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.event_day_schedules
      WHERE event_day_schedules.id = event_day_schedule_entries.day_schedule_id
        AND public.is_org_admin(event_day_schedules.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.event_day_schedules
      WHERE event_day_schedules.id = event_day_schedule_entries.day_schedule_id
        AND public.is_org_admin(event_day_schedules.org_id)
    )
  );

CREATE POLICY "event_day_schedule_entries_super_admin_all"
  ON public.event_day_schedule_entries FOR ALL
  USING (public.is_super_admin());
