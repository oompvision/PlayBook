-- ============================================================
-- 31. Dynamic Scheduling
-- Adds scheduling_type + bookable_window_days to organizations,
-- and creates tables for dynamic schedule rules, facility groups,
-- facility group members, and schedule block-outs.
-- ============================================================

-- ─── A. Org-level columns ───────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS scheduling_type text NOT NULL DEFAULT 'slot_based'
    CHECK (scheduling_type IN ('slot_based', 'dynamic')),
  ADD COLUMN IF NOT EXISTS bookable_window_days integer NOT NULL DEFAULT 30;

-- ─── B. dynamic_schedule_rules ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.dynamic_schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bay_id uuid NOT NULL REFERENCES public.bays(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
  open_time time NOT NULL,
  close_time time NOT NULL,
  available_durations integer[] NOT NULL DEFAULT '{60}',
  buffer_minutes integer NOT NULL DEFAULT 0,
  start_time_granularity integer NOT NULL DEFAULT 30
    CHECK (start_time_granularity IN (15, 30, 60)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bay_id, day_of_week),
  CHECK (close_time > open_time)
);

CREATE INDEX IF NOT EXISTS idx_dynamic_schedule_rules_bay_dow
  ON public.dynamic_schedule_rules (bay_id, day_of_week);

-- Auto-update updated_at
CREATE TRIGGER set_dynamic_schedule_rules_updated_at
  BEFORE UPDATE ON public.dynamic_schedule_rules
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─── C. facility_groups ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.facility_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_groups_org
  ON public.facility_groups (org_id);

CREATE TRIGGER set_facility_groups_updated_at
  BEFORE UPDATE ON public.facility_groups
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─── D. facility_group_members ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.facility_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.facility_groups(id) ON DELETE CASCADE,
  bay_id uuid NOT NULL REFERENCES public.bays(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bay_id) -- a bay can belong to at most one group
);

CREATE INDEX IF NOT EXISTS idx_facility_group_members_group
  ON public.facility_group_members (group_id);

CREATE INDEX IF NOT EXISTS idx_facility_group_members_bay
  ON public.facility_group_members (bay_id);

-- ─── E. schedule_block_outs ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.schedule_block_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bay_id uuid NOT NULL REFERENCES public.bays(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_schedule_block_outs_bay_date
  ON public.schedule_block_outs (bay_id, date);

CREATE TRIGGER set_schedule_block_outs_updated_at
  BEFORE UPDATE ON public.schedule_block_outs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─── F. RLS ─────────────────────────────────────────────────

ALTER TABLE public.dynamic_schedule_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_block_outs ENABLE ROW LEVEL SECURITY;

-- Public read (customers need to query rules for availability)
CREATE POLICY "dynamic_schedule_rules_public_read"
  ON public.dynamic_schedule_rules FOR SELECT
  USING (true);

CREATE POLICY "facility_groups_public_read"
  ON public.facility_groups FOR SELECT
  USING (true);

CREATE POLICY "facility_group_members_public_read"
  ON public.facility_group_members FOR SELECT
  USING (true);

CREATE POLICY "schedule_block_outs_public_read"
  ON public.schedule_block_outs FOR SELECT
  USING (true);

-- Admin write (scoped to their org)
CREATE POLICY "dynamic_schedule_rules_admin_all"
  ON public.dynamic_schedule_rules FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

CREATE POLICY "facility_groups_admin_all"
  ON public.facility_groups FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

CREATE POLICY "facility_group_members_admin_all"
  ON public.facility_group_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.facility_groups fg
      WHERE fg.id = facility_group_members.group_id
      AND public.is_org_admin(fg.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facility_groups fg
      WHERE fg.id = facility_group_members.group_id
      AND public.is_org_admin(fg.org_id)
    )
  );

CREATE POLICY "schedule_block_outs_admin_all"
  ON public.schedule_block_outs FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- Super admin full access
CREATE POLICY "dynamic_schedule_rules_super_admin_all"
  ON public.dynamic_schedule_rules FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "facility_groups_super_admin_all"
  ON public.facility_groups FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "facility_group_members_super_admin_all"
  ON public.facility_group_members FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "schedule_block_outs_super_admin_all"
  ON public.schedule_block_outs FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
