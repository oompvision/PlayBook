-- ============================================================
-- 36. Membership Tiers
-- Adds opt-in membership tier support per org:
--   - Organizations columns for feature toggle + booking windows
--   - membership_tiers table (one tier per org in v1)
--   - user_memberships table (tracks subscriptions)
--   - Discount columns on bookings
--   - Helper functions for membership checks
--   - RLS policies
-- ============================================================

-- ============================================================
-- 1. Organizations table — new columns
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS membership_tiers_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS guest_booking_window_days INTEGER,
  ADD COLUMN IF NOT EXISTS member_booking_window_days INTEGER;

-- Backfill guest_booking_window_days from existing bookable_window_days
UPDATE public.organizations
SET guest_booking_window_days = COALESCE(bookable_window_days, 30)
WHERE guest_booking_window_days IS NULL;

-- ============================================================
-- 2. membership_tiers table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.membership_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Membership',
  benefit_description TEXT,
  discount_type TEXT NOT NULL DEFAULT 'percent'
    CHECK (discount_type IN ('flat', 'percent')),
  discount_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_monthly_cents INTEGER,
  price_yearly_cents INTEGER,
  stripe_product_id TEXT,
  stripe_price_monthly_id TEXT,
  stripe_price_yearly_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_tiers_org
  ON public.membership_tiers(org_id);

-- ============================================================
-- 3. user_memberships table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier_id UUID NOT NULL REFERENCES public.membership_tiers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'past_due', 'cancelled', 'admin_granted')),
  source TEXT NOT NULL DEFAULT 'stripe'
    CHECK (source IN ('stripe', 'admin')),
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  current_period_end TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_memberships_org
  ON public.user_memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_user_memberships_user
  ON public.user_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memberships_status
  ON public.user_memberships(status);
CREATE INDEX IF NOT EXISTS idx_user_memberships_stripe_sub
  ON public.user_memberships(stripe_subscription_id);

-- ============================================================
-- 4. Discount columns on bookings
-- ============================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_description TEXT;

-- ============================================================
-- 5. Updated-at triggers
-- ============================================================

CREATE TRIGGER set_membership_tiers_updated_at
  BEFORE UPDATE ON public.membership_tiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_user_memberships_updated_at
  BEFORE UPDATE ON public.user_memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 6. RLS — membership_tiers
-- ============================================================

ALTER TABLE public.membership_tiers ENABLE ROW LEVEL SECURITY;

-- Super admin: full access
CREATE POLICY "membership_tiers_super_admin_all"
  ON public.membership_tiers FOR ALL
  USING (public.is_super_admin());

-- Org admin: full access scoped to their org
CREATE POLICY "membership_tiers_admin_all"
  ON public.membership_tiers FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- Public read: customers (and anonymous) can view tier info on membership page
CREATE POLICY "membership_tiers_public_read"
  ON public.membership_tiers FOR SELECT
  USING (true);

-- ============================================================
-- 7. RLS — user_memberships
-- ============================================================

ALTER TABLE public.user_memberships ENABLE ROW LEVEL SECURITY;

-- Super admin: full access
CREATE POLICY "user_memberships_super_admin_all"
  ON public.user_memberships FOR ALL
  USING (public.is_super_admin());

-- Org admin: full access scoped to their org
CREATE POLICY "user_memberships_admin_all"
  ON public.user_memberships FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- Customers: read their own membership
CREATE POLICY "user_memberships_customer_read_own"
  ON public.user_memberships FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- 8. Helper function: check if user has active membership
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_active_member(
  p_org_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_memberships
    WHERE org_id = p_org_id
      AND user_id = p_user_id
      AND (
        (status = 'active' AND (current_period_end IS NULL OR current_period_end > NOW()))
        OR
        (status = 'admin_granted' AND (expires_at IS NULL OR expires_at > NOW()))
        OR
        (status = 'cancelled' AND current_period_end IS NOT NULL AND current_period_end > NOW())
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- 9. Helper function: get effective bookable window for a user
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_effective_bookable_window(
  p_org_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_org RECORD;
BEGIN
  SELECT membership_tiers_enabled, bookable_window_days,
         guest_booking_window_days, member_booking_window_days
  INTO v_org
  FROM public.organizations
  WHERE id = p_org_id;

  -- If membership tiers not enabled, use the standard bookable_window_days
  IF NOT COALESCE(v_org.membership_tiers_enabled, FALSE) THEN
    RETURN COALESCE(v_org.bookable_window_days, 30);
  END IF;

  -- If user is an active member, use the member window
  IF p_user_id IS NOT NULL AND public.is_active_member(p_org_id, p_user_id) THEN
    RETURN COALESCE(v_org.member_booking_window_days, v_org.guest_booking_window_days, v_org.bookable_window_days, 30);
  END IF;

  -- Otherwise use guest window
  RETURN COALESCE(v_org.guest_booking_window_days, v_org.bookable_window_days, 30);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
