-- ============================================================
-- 38. Events Core
-- Tables: events, event_bays, event_registrations
-- ============================================================

-- ============================================================
-- 38a. events — core event record
-- ============================================================

CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,

  -- Event details
  name TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  price_cents INTEGER NOT NULL DEFAULT 0,

  -- Access control
  members_only BOOLEAN NOT NULL DEFAULT FALSE,
  member_enrollment_days_before INTEGER,
  guest_enrollment_days_before INTEGER NOT NULL DEFAULT 7,

  -- Waitlist promotion window (hours) — configurable per event, defaults to org setting
  waitlist_promotion_hours INTEGER NOT NULL DEFAULT 24,

  -- Status lifecycle: draft → published → completed/cancelled
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),

  -- Recurring event support (Phase 3 — nullable for now)
  parent_event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  recurrence_rule JSONB,

  -- Template support (Phase 3 — nullable for now)
  template_id UUID,

  -- Audit
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Validate end_time > start_time
  CHECK (end_time > start_time)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_org_date
  ON public.events (org_id, start_time);
CREATE INDEX IF NOT EXISTS idx_events_org_status
  ON public.events (org_id, status);
CREATE INDEX IF NOT EXISTS idx_events_location
  ON public.events (location_id) WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_parent
  ON public.events (parent_event_id) WHERE parent_event_id IS NOT NULL;

-- Auto-update updated_at
CREATE TRIGGER set_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 38b. event_bays — junction: which bays an event uses
-- ============================================================

CREATE TABLE IF NOT EXISTS public.event_bays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  bay_id UUID NOT NULL REFERENCES public.bays(id) ON DELETE CASCADE,
  UNIQUE (event_id, bay_id)
);

CREATE INDEX IF NOT EXISTS idx_event_bays_event
  ON public.event_bays (event_id);
CREATE INDEX IF NOT EXISTS idx_event_bays_bay
  ON public.event_bays (bay_id);

-- ============================================================
-- 38c. event_registrations — user registrations + waitlist
-- ============================================================

CREATE TABLE IF NOT EXISTS public.event_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Registration status
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'waitlisted', 'cancelled', 'pending_payment')),

  -- Waitlist tracking
  waitlist_position INTEGER,

  -- Payment tracking
  payment_status TEXT
    CHECK (payment_status IN ('pending', 'paid', 'refunded', 'waived')),
  payment_intent_id TEXT,

  -- Timestamps
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  promoted_at TIMESTAMPTZ,
  promotion_expires_at TIMESTAMPTZ,

  -- Prevent duplicate active registrations
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_registrations_event
  ON public.event_registrations (event_id);
CREATE INDEX IF NOT EXISTS idx_event_registrations_user
  ON public.event_registrations (user_id);
CREATE INDEX IF NOT EXISTS idx_event_registrations_org
  ON public.event_registrations (org_id);
CREATE INDEX IF NOT EXISTS idx_event_registrations_status
  ON public.event_registrations (event_id, status);

-- ============================================================
-- 38d. Row Level Security
-- ============================================================

-- events
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Public can read published events (for browsing)
CREATE POLICY "events_public_read_published"
  ON public.events FOR SELECT
  USING (status = 'published');

-- Admins can do everything for their org
CREATE POLICY "events_admin_all"
  ON public.events FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- Super admin full access
CREATE POLICY "events_super_admin_all"
  ON public.events FOR ALL
  USING (public.is_super_admin());

-- event_bays
ALTER TABLE public.event_bays ENABLE ROW LEVEL SECURITY;

-- Public can read event_bays for published events
CREATE POLICY "event_bays_public_read"
  ON public.event_bays FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events
      WHERE events.id = event_bays.event_id
        AND events.status = 'published'
    )
  );

-- Admins can manage event_bays for their org's events
CREATE POLICY "event_bays_admin_all"
  ON public.event_bays FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events
      WHERE events.id = event_bays.event_id
        AND public.is_org_admin(events.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events
      WHERE events.id = event_bays.event_id
        AND public.is_org_admin(events.org_id)
    )
  );

-- Super admin full access
CREATE POLICY "event_bays_super_admin_all"
  ON public.event_bays FOR ALL
  USING (public.is_super_admin());

-- event_registrations
ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;

-- Users can read their own registrations
CREATE POLICY "event_registrations_select_own"
  ON public.event_registrations FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own registrations (for registering)
CREATE POLICY "event_registrations_insert_own"
  ON public.event_registrations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own registrations (for cancelling)
CREATE POLICY "event_registrations_update_own"
  ON public.event_registrations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins can do everything for their org's registrations
CREATE POLICY "event_registrations_admin_all"
  ON public.event_registrations FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- Super admin full access
CREATE POLICY "event_registrations_super_admin_all"
  ON public.event_registrations FOR ALL
  USING (public.is_super_admin());

-- ============================================================
-- 38e. Helper function: get registration count for an event
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_event_registration_count(p_event_id UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.event_registrations
  WHERE event_id = p_event_id
    AND status IN ('confirmed', 'pending_payment');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- 38f. Enable Supabase Realtime for event_registrations
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.event_registrations;
