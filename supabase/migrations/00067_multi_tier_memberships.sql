-- ============================================================
-- 67. Multi-Tier Memberships with Credits
-- Expands the single-tier membership model to support up to 10
-- configurable membership tiers per org, each with independent
-- pricing, discounts, booking windows, and credit allowances.
--
-- Changes:
--   1. membership_tiers: drop unique(org_id), add sort_order,
--      per-tier bookable_window_days, credit columns
--   2. organizations: add credit_type column
--   3. New tables: membership_credit_balances, membership_credit_transactions
--   4. Updated RPC: get_effective_bookable_window (tier-aware)
--   5. New RPCs: get_or_create_credit_balance, apply_booking_credits, refund_booking_credits
--   6. RLS policies for new tables
-- ============================================================

-- ============================================================
-- 1. membership_tiers — multi-tier support
-- ============================================================

-- Drop the one-tier-per-org unique constraint
ALTER TABLE public.membership_tiers
  DROP CONSTRAINT IF EXISTS membership_tiers_org_id_key;

-- Add new columns
ALTER TABLE public.membership_tiers
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS bookable_window_days INTEGER,
  ADD COLUMN IF NOT EXISTS credit_amount INTEGER,
  ADD COLUMN IF NOT EXISTS credit_period TEXT;

-- Constraints
ALTER TABLE public.membership_tiers
  ADD CONSTRAINT membership_tiers_sort_order_range
    CHECK (sort_order BETWEEN 1 AND 10);

ALTER TABLE public.membership_tiers
  ADD CONSTRAINT membership_tiers_credit_period_valid
    CHECK (credit_period IS NULL OR credit_period IN ('daily', 'weekly', 'monthly'));

-- Unique sort_order per org (no two tiers at same level)
ALTER TABLE public.membership_tiers
  ADD CONSTRAINT membership_tiers_org_sort_unique
    UNIQUE (org_id, sort_order);

-- ============================================================
-- 2. organizations — credit type preference
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS credit_type TEXT;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_credit_type_valid
    CHECK (credit_type IS NULL OR credit_type IN ('hours', 'value'));

-- ============================================================
-- 3. membership_credit_balances — tracks credits per period
-- ============================================================

CREATE TABLE IF NOT EXISTS public.membership_credit_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tier_id UUID NOT NULL REFERENCES public.membership_tiers(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  credits_total INTEGER NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, org_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_credit_balances_user_org
  ON public.membership_credit_balances(user_id, org_id);

CREATE INDEX IF NOT EXISTS idx_credit_balances_period
  ON public.membership_credit_balances(period_start, period_end);

-- ============================================================
-- 4. membership_credit_transactions — audit trail for credits
-- ============================================================

CREATE TABLE IF NOT EXISTS public.membership_credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  balance_id UUID NOT NULL REFERENCES public.membership_credit_balances(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('grant', 'use', 'refund', 'expire')),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_balance
  ON public.membership_credit_transactions(balance_id);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_booking
  ON public.membership_credit_transactions(booking_id);

-- ============================================================
-- 5. Add credit_cents column to bookings for tracking credit usage
-- ============================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS credit_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_description TEXT;

-- ============================================================
-- 6. RLS — membership_credit_balances
-- ============================================================

ALTER TABLE public.membership_credit_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_balances_super_admin_all"
  ON public.membership_credit_balances FOR ALL
  USING (public.is_super_admin());

CREATE POLICY "credit_balances_admin_all"
  ON public.membership_credit_balances FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

CREATE POLICY "credit_balances_customer_read_own"
  ON public.membership_credit_balances FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- 7. RLS — membership_credit_transactions
-- ============================================================

ALTER TABLE public.membership_credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_transactions_super_admin_all"
  ON public.membership_credit_transactions FOR ALL
  USING (public.is_super_admin());

CREATE POLICY "credit_transactions_admin_all"
  ON public.membership_credit_transactions FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

CREATE POLICY "credit_transactions_customer_read_own"
  ON public.membership_credit_transactions FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- 8. Updated RPC: get_effective_bookable_window (tier-aware)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_effective_bookable_window(
  p_org_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_org RECORD;
  v_tier_window INTEGER;
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

  -- If user is an active member, check their tier's window first
  IF p_user_id IS NOT NULL AND public.is_active_member(p_org_id, p_user_id) THEN
    -- Look up the user's active tier's bookable_window_days
    SELECT mt.bookable_window_days INTO v_tier_window
    FROM public.user_memberships um
    JOIN public.membership_tiers mt ON mt.id = um.tier_id
    WHERE um.org_id = p_org_id
      AND um.user_id = p_user_id
      AND (
        (um.status = 'active' AND (um.current_period_end IS NULL OR um.current_period_end > NOW()))
        OR (um.status = 'admin_granted' AND (um.expires_at IS NULL OR um.expires_at > NOW()))
        OR (um.status = 'cancelled' AND um.current_period_end IS NOT NULL AND um.current_period_end > NOW())
      )
    LIMIT 1;

    -- If tier has its own window, use it; otherwise fall back to org member window
    RETURN COALESCE(v_tier_window, v_org.member_booking_window_days, v_org.guest_booking_window_days, v_org.bookable_window_days, 30);
  END IF;

  -- Otherwise use guest window
  RETURN COALESCE(v_org.guest_booking_window_days, v_org.bookable_window_days, 30);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- 9. New RPC: get_or_create_credit_balance
-- Returns current credit balance for user, creating the period
-- record if it doesn't exist yet.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_or_create_credit_balance(
  p_org_id UUID,
  p_user_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_org RECORD;
  v_membership RECORD;
  v_tier RECORD;
  v_now TIMESTAMPTZ;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_balance RECORD;
  v_tz TEXT;
  v_local_now TIMESTAMP;
  v_local_start TIMESTAMP;
  v_local_end TIMESTAMP;
BEGIN
  -- Get org info
  SELECT timezone, credit_type
  INTO v_org
  FROM public.organizations
  WHERE id = p_org_id;

  v_tz := COALESCE(v_org.timezone, 'America/New_York');

  -- Get active membership
  SELECT um.tier_id, um.status
  INTO v_membership
  FROM public.user_memberships um
  WHERE um.org_id = p_org_id
    AND um.user_id = p_user_id
    AND (
      (um.status = 'active' AND (um.current_period_end IS NULL OR um.current_period_end > NOW()))
      OR (um.status = 'admin_granted' AND (um.expires_at IS NULL OR um.expires_at > NOW()))
      OR (um.status = 'cancelled' AND um.current_period_end IS NOT NULL AND um.current_period_end > NOW())
    )
  LIMIT 1;

  -- No active membership → return null
  IF v_membership IS NULL THEN
    RETURN json_build_object(
      'has_credits', false,
      'credits_total', 0,
      'credits_used', 0,
      'credits_remaining', 0,
      'credit_type', v_org.credit_type,
      'period_end', NULL
    );
  END IF;

  -- Get tier's credit config
  SELECT credit_amount, credit_period
  INTO v_tier
  FROM public.membership_tiers
  WHERE id = v_membership.tier_id;

  -- No credits configured on this tier
  IF v_tier.credit_amount IS NULL OR v_tier.credit_amount = 0
     OR v_tier.credit_period IS NULL OR v_org.credit_type IS NULL THEN
    RETURN json_build_object(
      'has_credits', false,
      'credits_total', 0,
      'credits_used', 0,
      'credits_remaining', 0,
      'credit_type', v_org.credit_type,
      'period_end', NULL
    );
  END IF;

  -- Calculate period boundaries in org timezone
  v_now := NOW();
  v_local_now := v_now AT TIME ZONE v_tz;

  CASE v_tier.credit_period
    WHEN 'daily' THEN
      v_local_start := date_trunc('day', v_local_now);
      v_local_end := v_local_start + INTERVAL '1 day';
    WHEN 'weekly' THEN
      -- Monday-based weeks
      v_local_start := date_trunc('week', v_local_now);
      v_local_end := v_local_start + INTERVAL '1 week';
    WHEN 'monthly' THEN
      v_local_start := date_trunc('month', v_local_now);
      v_local_end := v_local_start + INTERVAL '1 month';
  END CASE;

  -- Convert back to timestamptz
  v_period_start := v_local_start AT TIME ZONE v_tz;
  v_period_end := v_local_end AT TIME ZONE v_tz;

  -- Try to get existing balance for this period
  SELECT * INTO v_balance
  FROM public.membership_credit_balances
  WHERE user_id = p_user_id
    AND org_id = p_org_id
    AND period_start = v_period_start;

  -- Create if not exists
  IF v_balance IS NULL THEN
    INSERT INTO public.membership_credit_balances (
      user_id, org_id, tier_id, period_start, period_end, credits_total, credits_used
    ) VALUES (
      p_user_id, p_org_id, v_membership.tier_id, v_period_start, v_period_end, v_tier.credit_amount, 0
    )
    RETURNING * INTO v_balance;

    -- Log the grant transaction
    INSERT INTO public.membership_credit_transactions (
      user_id, org_id, balance_id, amount, type, description
    ) VALUES (
      p_user_id, p_org_id, v_balance.id, v_tier.credit_amount, 'grant',
      v_tier.credit_period || ' credit allowance'
    );
  END IF;

  RETURN json_build_object(
    'has_credits', true,
    'balance_id', v_balance.id,
    'credits_total', v_balance.credits_total,
    'credits_used', v_balance.credits_used,
    'credits_remaining', GREATEST(0, v_balance.credits_total - v_balance.credits_used),
    'credit_type', v_org.credit_type,
    'credit_period', v_tier.credit_period,
    'period_start', v_balance.period_start,
    'period_end', v_balance.period_end
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 10. New RPC: apply_booking_credits
-- Deducts credits from the user's current balance for a booking.
-- Returns how much was covered by credits.
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_booking_credits(
  p_org_id UUID,
  p_user_id UUID,
  p_booking_id UUID,
  p_slot_duration_minutes INTEGER,
  p_booking_total_cents INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_org RECORD;
  v_balance RECORD;
  v_membership RECORD;
  v_tier RECORD;
  v_credits_remaining INTEGER;
  v_credits_to_use INTEGER;
  v_cents_covered INTEGER;
  v_tz TEXT;
  v_period_start TIMESTAMPTZ;
  v_local_now TIMESTAMP;
  v_local_start TIMESTAMP;
BEGIN
  -- Get org credit type
  SELECT credit_type, timezone INTO v_org
  FROM public.organizations
  WHERE id = p_org_id;

  IF v_org.credit_type IS NULL THEN
    RETURN json_build_object('credits_applied_cents', 0, 'credits_applied_units', 0, 'remaining_to_pay_cents', p_booking_total_cents);
  END IF;

  v_tz := COALESCE(v_org.timezone, 'America/New_York');

  -- Get the user's active membership to find their tier
  SELECT um.tier_id INTO v_membership
  FROM public.user_memberships um
  WHERE um.org_id = p_org_id
    AND um.user_id = p_user_id
    AND (
      (um.status = 'active' AND (um.current_period_end IS NULL OR um.current_period_end > NOW()))
      OR (um.status = 'admin_granted' AND (um.expires_at IS NULL OR um.expires_at > NOW()))
      OR (um.status = 'cancelled' AND um.current_period_end IS NOT NULL AND um.current_period_end > NOW())
    )
  LIMIT 1;

  IF v_membership IS NULL THEN
    RETURN json_build_object('credits_applied_cents', 0, 'credits_applied_units', 0, 'remaining_to_pay_cents', p_booking_total_cents);
  END IF;

  -- Get tier credit config
  SELECT credit_amount, credit_period INTO v_tier
  FROM public.membership_tiers
  WHERE id = v_membership.tier_id;

  IF v_tier.credit_amount IS NULL OR v_tier.credit_period IS NULL THEN
    RETURN json_build_object('credits_applied_cents', 0, 'credits_applied_units', 0, 'remaining_to_pay_cents', p_booking_total_cents);
  END IF;

  -- Calculate current period start
  v_local_now := NOW() AT TIME ZONE v_tz;
  CASE v_tier.credit_period
    WHEN 'daily' THEN v_local_start := date_trunc('day', v_local_now);
    WHEN 'weekly' THEN v_local_start := date_trunc('week', v_local_now);
    WHEN 'monthly' THEN v_local_start := date_trunc('month', v_local_now);
  END CASE;
  v_period_start := v_local_start AT TIME ZONE v_tz;

  -- Get balance for current period (lock for update)
  SELECT * INTO v_balance
  FROM public.membership_credit_balances
  WHERE user_id = p_user_id
    AND org_id = p_org_id
    AND period_start = v_period_start
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RETURN json_build_object('credits_applied_cents', 0, 'credits_applied_units', 0, 'remaining_to_pay_cents', p_booking_total_cents);
  END IF;

  v_credits_remaining := GREATEST(0, v_balance.credits_total - v_balance.credits_used);

  IF v_credits_remaining = 0 THEN
    RETURN json_build_object('credits_applied_cents', 0, 'credits_applied_units', 0, 'remaining_to_pay_cents', p_booking_total_cents);
  END IF;

  -- Calculate credit application based on org credit_type
  IF v_org.credit_type = 'hours' THEN
    -- credit_amount is in minutes, use min of remaining vs slot duration
    v_credits_to_use := LEAST(v_credits_remaining, p_slot_duration_minutes);
    -- Convert minutes to cents proportionally
    IF p_slot_duration_minutes > 0 THEN
      v_cents_covered := LEAST(
        p_booking_total_cents,
        ROUND((v_credits_to_use::NUMERIC / p_slot_duration_minutes::NUMERIC) * p_booking_total_cents)::INTEGER
      );
    ELSE
      v_cents_covered := 0;
    END IF;
  ELSE
    -- credit_type = 'value', credit_amount is in cents
    v_credits_to_use := LEAST(v_credits_remaining, p_booking_total_cents);
    v_cents_covered := v_credits_to_use;
  END IF;

  -- Update balance
  UPDATE public.membership_credit_balances
  SET credits_used = credits_used + v_credits_to_use
  WHERE id = v_balance.id;

  -- Log transaction
  INSERT INTO public.membership_credit_transactions (
    user_id, org_id, balance_id, booking_id, amount, type, description
  ) VALUES (
    p_user_id, p_org_id, v_balance.id, p_booking_id, -v_credits_to_use, 'use',
    CASE v_org.credit_type
      WHEN 'hours' THEN v_credits_to_use || ' min credit applied'
      ELSE '$' || ROUND(v_credits_to_use / 100.0, 2) || ' credit applied'
    END
  );

  -- Update booking with credit info
  UPDATE public.bookings
  SET credit_cents = v_cents_covered,
      credit_description = CASE v_org.credit_type
        WHEN 'hours' THEN v_credits_to_use || ' min membership credit'
        ELSE '$' || ROUND(v_cents_covered / 100.0, 2) || ' membership credit'
      END
  WHERE id = p_booking_id;

  RETURN json_build_object(
    'credits_applied_cents', v_cents_covered,
    'credits_applied_units', v_credits_to_use,
    'remaining_to_pay_cents', GREATEST(0, p_booking_total_cents - v_cents_covered)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 11. New RPC: refund_booking_credits
-- Refunds credits when a booking is cancelled (same period only).
-- ============================================================

CREATE OR REPLACE FUNCTION public.refund_booking_credits(
  p_booking_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_txn RECORD;
  v_balance RECORD;
BEGIN
  -- Find the 'use' transaction for this booking
  FOR v_txn IN
    SELECT ct.*, cb.period_end
    FROM public.membership_credit_transactions ct
    JOIN public.membership_credit_balances cb ON cb.id = ct.balance_id
    WHERE ct.booking_id = p_booking_id
      AND ct.type = 'use'
  LOOP
    -- Only refund if still within the same period
    IF NOW() < v_txn.period_end THEN
      -- Reverse the usage
      UPDATE public.membership_credit_balances
      SET credits_used = GREATEST(0, credits_used + v_txn.amount)  -- amount is negative, so adding reverses
      WHERE id = v_txn.balance_id;

      -- Log refund transaction
      INSERT INTO public.membership_credit_transactions (
        user_id, org_id, balance_id, booking_id, amount, type, description
      ) VALUES (
        v_txn.user_id, v_txn.org_id, v_txn.balance_id, p_booking_id,
        ABS(v_txn.amount), 'refund', 'Credit refund for cancelled booking'
      );
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
