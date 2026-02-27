-- ============================================================
-- 24. Notification System
-- Tables: notifications, notification_preferences,
--         org_email_settings, pending_signup_notifications
-- ============================================================

-- Notification type values (shared CHECK constraint)
-- new_customer_signup, welcome, booking_confirmed, booking_canceled,
-- booking_modified, booking_reminder_48hr, cancellation_window_closed,
-- guest_booking_created, admin_daily_digest

-- ============================================================
-- 24a. notifications — central in-app notification table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_type text NOT NULL CHECK (recipient_type IN ('customer', 'org_admin')),
  type text NOT NULL CHECK (type IN (
    'new_customer_signup', 'welcome', 'booking_confirmed', 'booking_canceled',
    'booking_modified', 'booking_reminder_48hr', 'cancellation_window_closed',
    'guest_booking_created', 'admin_daily_digest'
  )),
  title text NOT NULL,
  message text NOT NULL,
  link text,
  is_read boolean NOT NULL DEFAULT false,
  email_sent boolean NOT NULL DEFAULT false,
  email_sent_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON public.notifications (recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id
  ON public.notifications (recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org_id
  ON public.notifications (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON public.notifications (created_at DESC);

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  USING (auth.uid() = recipient_id);

-- Users can update is_read on their own notifications only
CREATE POLICY "notifications_update_own_read"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);

-- Super admin full access
CREATE POLICY "notifications_super_admin_all"
  ON public.notifications FOR ALL
  USING (public.is_super_admin());

-- ============================================================
-- 24b. notification_preferences — per-user in-app preferences
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type IN (
    'new_customer_signup', 'welcome', 'booking_confirmed', 'booking_canceled',
    'booking_modified', 'booking_reminder_48hr', 'cancellation_window_closed',
    'guest_booking_created', 'admin_daily_digest'
  )),
  in_app_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id, notification_type)
);

-- RLS
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_preferences_select_own"
  ON public.notification_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "notification_preferences_insert_own"
  ON public.notification_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notification_preferences_update_own"
  ON public.notification_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Super admin full access
CREATE POLICY "notification_preferences_super_admin_all"
  ON public.notification_preferences FOR ALL
  USING (public.is_super_admin());

-- ============================================================
-- 24c. org_email_settings — org-level email toggles
-- ============================================================

CREATE TABLE IF NOT EXISTS public.org_email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type IN (
    'new_customer_signup', 'welcome', 'booking_confirmed', 'booking_canceled',
    'booking_modified', 'booking_reminder_48hr', 'cancellation_window_closed',
    'guest_booking_created', 'admin_daily_digest'
  )),
  email_to_customer boolean NOT NULL DEFAULT true,
  email_to_admin boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, notification_type)
);

-- RLS
ALTER TABLE public.org_email_settings ENABLE ROW LEVEL SECURITY;

-- Org admins can read their org's settings
CREATE POLICY "org_email_settings_select_admin"
  ON public.org_email_settings FOR SELECT
  USING (public.is_org_admin(org_id));

-- Org admins can update their org's settings
CREATE POLICY "org_email_settings_update_admin"
  ON public.org_email_settings FOR UPDATE
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- Super admin full access
CREATE POLICY "org_email_settings_super_admin_all"
  ON public.org_email_settings FOR ALL
  USING (public.is_super_admin());

-- ============================================================
-- 24d. pending_signup_notifications — staging for batched digests
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pending_signup_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_email text NOT NULL,
  customer_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  batched_at timestamptz
);

-- Index for cron query: unbatched rows grouped by org
CREATE INDEX IF NOT EXISTS idx_pending_signup_org_unbatched
  ON public.pending_signup_notifications (org_id, created_at)
  WHERE batched_at IS NULL;

-- RLS: service role only (no user-facing policies)
ALTER TABLE public.pending_signup_notifications ENABLE ROW LEVEL SECURITY;

-- Super admin can read for debugging
CREATE POLICY "pending_signup_super_admin_all"
  ON public.pending_signup_notifications FOR ALL
  USING (public.is_super_admin());

-- ============================================================
-- 24e. Auto-seed org_email_settings on org creation
-- ============================================================

CREATE OR REPLACE FUNCTION public.seed_org_email_settings()
RETURNS TRIGGER AS $$
DECLARE
  v_types text[] := ARRAY[
    'new_customer_signup', 'welcome', 'booking_confirmed', 'booking_canceled',
    'booking_modified', 'booking_reminder_48hr', 'cancellation_window_closed',
    'guest_booking_created', 'admin_daily_digest'
  ];
  v_type text;
BEGIN
  FOREACH v_type IN ARRAY v_types LOOP
    INSERT INTO public.org_email_settings (org_id, notification_type)
    VALUES (NEW.id, v_type)
    ON CONFLICT (org_id, notification_type) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_seed_org_email_settings
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_org_email_settings();

-- Backfill existing organizations
DO $$
DECLARE
  v_org_id uuid;
  v_types text[] := ARRAY[
    'new_customer_signup', 'welcome', 'booking_confirmed', 'booking_canceled',
    'booking_modified', 'booking_reminder_48hr', 'cancellation_window_closed',
    'guest_booking_created', 'admin_daily_digest'
  ];
  v_type text;
BEGIN
  FOR v_org_id IN SELECT id FROM public.organizations LOOP
    FOREACH v_type IN ARRAY v_types LOOP
      INSERT INTO public.org_email_settings (org_id, notification_type)
      VALUES (v_org_id, v_type)
      ON CONFLICT (org_id, notification_type) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;

-- ============================================================
-- 24f. Enable Supabase Realtime for notifications
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
