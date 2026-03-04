-- ============================================================
-- Phase 4: Dynamic Rate Overrides + Rate Tiers
-- ============================================================

-- A. dynamic_rate_overrides table
-- Allows admins to set custom hourly rates for specific date/time ranges
-- (e.g. holiday pricing, special event rates)
CREATE TABLE IF NOT EXISTS public.dynamic_rate_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bay_id uuid NOT NULL REFERENCES public.bays(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  hourly_rate_cents integer NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (bay_id, date, start_time),
  CHECK (end_time > start_time),
  CHECK (hourly_rate_cents >= 0)
);

-- RLS for dynamic_rate_overrides
ALTER TABLE public.dynamic_rate_overrides ENABLE ROW LEVEL SECURITY;

-- Public read (customers need to see pricing)
CREATE POLICY "dynamic_rate_overrides_public_read"
  ON public.dynamic_rate_overrides
  FOR SELECT
  USING (true);

-- Admin write
CREATE POLICY "dynamic_rate_overrides_admin_insert"
  ON public.dynamic_rate_overrides
  FOR INSERT
  WITH CHECK (public.is_org_admin(org_id) OR public.is_super_admin());

CREATE POLICY "dynamic_rate_overrides_admin_update"
  ON public.dynamic_rate_overrides
  FOR UPDATE
  USING (public.is_org_admin(org_id) OR public.is_super_admin());

CREATE POLICY "dynamic_rate_overrides_admin_delete"
  ON public.dynamic_rate_overrides
  FOR DELETE
  USING (public.is_org_admin(org_id) OR public.is_super_admin());

-- B. Add rate_tiers JSONB column to dynamic_schedule_rules
-- Format: [{"start_time": "09:00", "end_time": "17:00", "hourly_rate_cents": 4000}, ...]
-- If null, use the bay's hourly_rate_cents as the flat rate
ALTER TABLE public.dynamic_schedule_rules
  ADD COLUMN IF NOT EXISTS rate_tiers jsonb;
