-- ============================================================
-- 54. Add discount tracking to event_registrations
--
-- The event registration flow calculates member discounts at
-- checkout and passes the discounted amount to Stripe, but never
-- stores the discount on the registration itself. This means
-- my-bookings always shows the base event price instead of what
-- the member actually paid.
-- ============================================================

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_description text;
