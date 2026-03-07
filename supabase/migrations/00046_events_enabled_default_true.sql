-- ============================================================
-- 46. Change events_enabled default to TRUE and enable for all existing orgs
-- Events are now on by default — admins can opt out if needed.
-- ============================================================

-- Set all existing orgs to events_enabled = true
UPDATE public.organizations SET events_enabled = TRUE WHERE events_enabled = FALSE;

-- Change the column default for new orgs
ALTER TABLE public.organizations ALTER COLUMN events_enabled SET DEFAULT TRUE;
