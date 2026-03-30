-- ============================================================================
-- SOC II Compliance: Account Deletion & Data Anonymization
-- Fixes FK cascade rules to preserve financial records, adds anonymization RPC.
-- ============================================================================

-- ── 1. Fix FK constraints that block or destroy data on user deletion ──────

-- events.created_by: currently NO cascade action → deletion fails with FK error
-- Make nullable and set ON DELETE SET NULL
ALTER TABLE public.events ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_created_by_fkey;
ALTER TABLE public.events
  ADD CONSTRAINT events_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- admin_invitations.invited_by: currently NO cascade action → orphaned records
ALTER TABLE public.admin_invitations ALTER COLUMN invited_by DROP NOT NULL;
ALTER TABLE public.admin_invitations
  DROP CONSTRAINT IF EXISTS admin_invitations_invited_by_fkey;
ALTER TABLE public.admin_invitations
  ADD CONSTRAINT admin_invitations_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- bookings.customer_id: currently CASCADE → destroys booking history
-- Already nullable since migration 00019; just change cascade behavior
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_customer_id_fkey;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- booking_payments.booking_id: currently CASCADE → destroys financial records
-- Make nullable so payments survive even if booking row is somehow deleted
ALTER TABLE public.booking_payments ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE public.booking_payments
  DROP CONSTRAINT IF EXISTS booking_payments_booking_id_fkey;
ALTER TABLE public.booking_payments
  ADD CONSTRAINT booking_payments_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;

-- ── 2. Account anonymization RPC ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.anonymize_account(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_uuid_prefix text;
BEGIN
  -- Get user's org for audit logging
  SELECT org_id INTO v_org_id
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Profile not found');
  END IF;

  v_uuid_prefix := substring(p_user_id::text from 1 for 8);

  -- 1. Detach bookings from user (preserves booking + payment records)
  UPDATE public.bookings
  SET customer_id = NULL,
      notes = NULL,
      guest_name = NULL,
      guest_email = NULL,
      guest_phone = NULL
  WHERE customer_id = p_user_id;

  -- 2. Cancel active memberships
  UPDATE public.user_memberships
  SET status = 'cancelled',
      cancelled_at = now()
  WHERE user_id = p_user_id
    AND status IN ('active', 'past_due');

  -- 3. Delete non-financial user data
  DELETE FROM public.notifications WHERE recipient_id = p_user_id;
  DELETE FROM public.notification_preferences WHERE user_id = p_user_id;
  DELETE FROM public.user_location_preferences WHERE user_id = p_user_id;
  DELETE FROM public.pending_signup_notifications WHERE customer_id = p_user_id;

  -- 4. Anonymize the profile (last step before auth deletion)
  UPDATE public.profiles
  SET full_name = '[Deleted User]',
      phone = NULL,
      email = 'deleted-' || v_uuid_prefix || '@redacted.local'
  WHERE id = p_user_id;

  -- 5. Log the deletion event
  BEGIN
    INSERT INTO public.audit_logs (
      org_id, user_id, action, resource_type, resource_id, metadata
    ) VALUES (
      v_org_id, p_user_id, 'delete'::public.audit_action, 'account',
      p_user_id::text,
      jsonb_build_object('reason', 'account_deletion_request', 'anonymized', true)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Don't block deletion if audit fails
  END;

  RETURN json_build_object('success', true);
END;
$$;
