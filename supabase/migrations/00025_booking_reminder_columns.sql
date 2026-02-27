-- ============================================================
-- 25. Add reminder tracking columns to bookings
-- Used by the hourly cron job to prevent duplicate sends.
-- ============================================================

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS reminder_48hr_sent_at timestamptz;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS cancel_window_notified_at timestamptz;
