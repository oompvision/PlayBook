-- ============================================================
-- 29. Add custom cancellation policy text to org_payment_settings
-- Allows admins to write/customize the refund policy shown to customers.
-- Auto-generated default is provided by the application layer.
-- ============================================================

ALTER TABLE public.org_payment_settings
  ADD COLUMN IF NOT EXISTS cancellation_policy_text TEXT;

-- Add a comment for documentation
COMMENT ON COLUMN public.org_payment_settings.cancellation_policy_text IS
  'Custom cancellation/refund policy text set by the org admin. If NULL, the app auto-generates policy text from cancellation_window_hours and payment_mode settings.';
