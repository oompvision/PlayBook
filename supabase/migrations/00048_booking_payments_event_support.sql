-- ============================================================
-- 48. Allow booking_payments for event registrations
-- Makes booking_id nullable and adds event_registration_id column
-- so paid event registrations can be tracked alongside bookings.
-- ============================================================

-- Make booking_id nullable (event registrations don't have a booking)
ALTER TABLE public.booking_payments
  ALTER COLUMN booking_id DROP NOT NULL;

-- Add event_registration_id column
ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS event_registration_id UUID
    REFERENCES public.event_registrations(id) ON DELETE CASCADE;

-- Index for looking up payments by event registration
CREATE INDEX IF NOT EXISTS idx_booking_payments_event_registration
  ON public.booking_payments(event_registration_id);

-- Ensure at least one of booking_id or event_registration_id is set
ALTER TABLE public.booking_payments
  ADD CONSTRAINT booking_payments_has_reference
  CHECK (booking_id IS NOT NULL OR event_registration_id IS NOT NULL);

-- Update customer RLS policy to also allow reading event registration payments
DROP POLICY IF EXISTS "booking_payments_customer_select" ON public.booking_payments;

CREATE POLICY "booking_payments_customer_select"
  ON public.booking_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings
      WHERE bookings.id = booking_payments.booking_id
        AND bookings.customer_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.event_registrations
      WHERE event_registrations.id = booking_payments.event_registration_id
        AND event_registrations.user_id = auth.uid()
    )
  );
