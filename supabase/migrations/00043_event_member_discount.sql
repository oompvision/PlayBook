-- Add separate event discount settings to membership_tiers
-- Allows orgs to configure a different member discount for event registration
-- vs the existing discount_type/discount_value for regular bookings.

ALTER TABLE public.membership_tiers
  ADD COLUMN IF NOT EXISTS event_discount_type TEXT NOT NULL DEFAULT 'percent'
    CHECK (event_discount_type IN ('flat', 'percent')),
  ADD COLUMN IF NOT EXISTS event_discount_value NUMERIC(10,2) NOT NULL DEFAULT 0;
