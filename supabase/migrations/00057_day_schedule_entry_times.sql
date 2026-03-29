-- ============================================================
-- 57. Add start_time/end_time to event_day_schedule_entries
-- When saving a day schedule, we capture the actual event times
-- so they are retained when the schedule is applied to new dates.
-- Also cleans up start_time/end_time from event_templates config.
-- ============================================================

-- 57a. Add time columns to event_day_schedule_entries
ALTER TABLE public.event_day_schedule_entries
  ADD COLUMN IF NOT EXISTS start_time TEXT,
  ADD COLUMN IF NOT EXISTS end_time TEXT;

-- 57b. Clean up existing event_templates: remove start_time/end_time from config jsonb
UPDATE public.event_templates
SET config = config - 'start_time' - 'end_time'
WHERE config ? 'start_time' OR config ? 'end_time';
