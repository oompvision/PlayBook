-- ============================================================
-- 28. Stripe Connect Foundation Tables
-- Tables: org_payment_settings, org_subscriptions, booking_payments
-- ============================================================

-- ============================================================
-- 28a. org_payment_settings
-- Controls how each org handles booking payments
-- ============================================================

CREATE TABLE IF NOT EXISTS public.org_payment_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Booking payment mode
  payment_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (payment_mode IN ('none', 'hold', 'charge_upfront', 'hold_charge_manual')),

  -- Stripe Connect (for customer charges flowing TO the org)
  stripe_account_id TEXT,
  stripe_onboarding_complete BOOLEAN DEFAULT FALSE,

  -- No-show / cancellation settings (Mode B)
  cancellation_window_hours INTEGER DEFAULT 24,
  no_show_fee_cents INTEGER,
  no_show_fee_type TEXT DEFAULT 'fixed'
    CHECK (no_show_fee_type IN ('fixed', 'full_booking')),

  -- Processing fee responsibility
  processing_fee_absorbed_by TEXT DEFAULT 'customer'
    CHECK (processing_fee_absorbed_by IN ('customer', 'org')),

  -- Platform transaction fee (EZBooker's cut of each customer charge)
  platform_fee_percent NUMERIC(5,2) DEFAULT 0.00,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(org_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_settings_org
  ON public.org_payment_settings(org_id);

-- ============================================================
-- 28b. org_subscriptions
-- Tracks the org's monthly platform subscription
-- Custom pricing set by SuperAdmin per org
-- ============================================================

CREATE TABLE IF NOT EXISTS public.org_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Stripe Billing references (on EZBooker's Stripe account, NOT Connect)
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  stripe_payment_method_id TEXT,

  -- Subscription details (set by SuperAdmin)
  price_cents INTEGER NOT NULL,
  billing_interval TEXT DEFAULT 'month'
    CHECK (billing_interval IN ('month', 'year')),
  notes TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('inactive', 'active', 'past_due', 'cancelled', 'trialing')),
  trial_end_date TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,

  -- Audit
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(org_id)
);

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_org
  ON public.org_subscriptions(org_id);
CREATE INDEX IF NOT EXISTS idx_org_subscriptions_status
  ON public.org_subscriptions(status);

-- ============================================================
-- 28c. booking_payments
-- Tracks payment state for each booking that involves a card
-- ============================================================

CREATE TABLE IF NOT EXISTS public.booking_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_email TEXT,

  -- Stripe references (on the org's connected account)
  stripe_customer_id TEXT,
  stripe_setup_intent_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_payment_method_id TEXT,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'card_saved',
      'charged',
      'released',
      'charge_failed',
      'refunded'
    )),

  -- Charge details
  amount_cents INTEGER,
  charge_type TEXT
    CHECK (charge_type IN ('no_show', 'upfront', 'manual')),
  charged_at TIMESTAMPTZ,
  charged_by UUID,
  released_at TIMESTAMPTZ,

  -- Cancellation policy snapshot (captured at booking time for chargeback defense)
  cancellation_policy_text TEXT,
  policy_agreed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_payments_booking
  ON public.booking_payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_payments_org
  ON public.booking_payments(org_id);
CREATE INDEX IF NOT EXISTS idx_booking_payments_status
  ON public.booking_payments(status);

-- ============================================================
-- 28d. Auto-update updated_at triggers
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_org_payment_settings_updated_at
  BEFORE UPDATE ON public.org_payment_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_org_subscriptions_updated_at
  BEFORE UPDATE ON public.org_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_booking_payments_updated_at
  BEFORE UPDATE ON public.booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 28e. Auto-seed org_payment_settings on org creation
-- ============================================================

CREATE OR REPLACE FUNCTION public.seed_org_payment_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.org_payment_settings (org_id)
  VALUES (NEW.id)
  ON CONFLICT (org_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_seed_org_payment_settings
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_org_payment_settings();

-- Backfill existing organizations
DO $$
DECLARE
  v_org_id uuid;
BEGIN
  FOR v_org_id IN SELECT id FROM public.organizations LOOP
    INSERT INTO public.org_payment_settings (org_id)
    VALUES (v_org_id)
    ON CONFLICT (org_id) DO NOTHING;
  END LOOP;
END;
$$;

-- ============================================================
-- 28f. Row Level Security
-- ============================================================

-- org_payment_settings
ALTER TABLE public.org_payment_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_payment_settings_super_admin_all"
  ON public.org_payment_settings FOR ALL
  USING (public.is_super_admin());

CREATE POLICY "org_payment_settings_admin_select"
  ON public.org_payment_settings FOR SELECT
  USING (public.is_org_admin(org_id));

CREATE POLICY "org_payment_settings_admin_insert"
  ON public.org_payment_settings FOR INSERT
  WITH CHECK (public.is_org_admin(org_id));

CREATE POLICY "org_payment_settings_admin_update"
  ON public.org_payment_settings FOR UPDATE
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- org_subscriptions
ALTER TABLE public.org_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_subscriptions_super_admin_all"
  ON public.org_subscriptions FOR ALL
  USING (public.is_super_admin());

-- Org admins can only READ their subscription (not modify)
-- Subscriptions are managed by SuperAdmin and Stripe webhooks (via service role)
CREATE POLICY "org_subscriptions_admin_select"
  ON public.org_subscriptions FOR SELECT
  USING (public.is_org_admin(org_id));

-- booking_payments
ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "booking_payments_super_admin_all"
  ON public.booking_payments FOR ALL
  USING (public.is_super_admin());

CREATE POLICY "booking_payments_admin_all"
  ON public.booking_payments FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- Customers can read their own booking's payment records
CREATE POLICY "booking_payments_customer_select"
  ON public.booking_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings
      WHERE bookings.id = booking_payments.booking_id
        AND bookings.customer_id = auth.uid()
    )
  );
