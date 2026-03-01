-- ============================================================
-- 30. Refund Tracking Columns on booking_payments
-- Adds columns to track refund amounts and notes for
-- full and partial refund support.
-- ============================================================

-- Track how much has been refunded (supports partial refunds)
ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS refunded_amount_cents INTEGER DEFAULT 0;

-- Admin note explaining why a refund was issued
ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS refund_note TEXT;

-- Timestamp when the refund was processed
ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

-- Who processed the refund (admin profile id)
ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS refunded_by UUID;

-- Add 'partially_refunded' status option
-- (existing check constraint only allows: pending, card_saved, charged, released, charge_failed, refunded)
ALTER TABLE public.booking_payments
  DROP CONSTRAINT IF EXISTS booking_payments_status_check;

ALTER TABLE public.booking_payments
  ADD CONSTRAINT booking_payments_status_check
  CHECK (status IN (
    'pending',
    'card_saved',
    'charged',
    'released',
    'charge_failed',
    'refunded',
    'partially_refunded'
  ));
