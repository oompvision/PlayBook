-- 00042: Ensure every org has a default location (fixes legacy orgs created
-- before multi-location support in 00034). Also backfills bays missing location_id.

-- 1. Create default locations for orgs that don't have any
INSERT INTO public.locations (org_id, name, is_active, is_default)
SELECT o.id, o.name, true, true
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.locations l WHERE l.org_id = o.id
)
ON CONFLICT DO NOTHING;

-- 2. Backfill bays missing location_id
UPDATE public.bays b
SET location_id = l.id
FROM public.locations l
WHERE l.org_id = b.org_id AND l.is_default = true AND b.location_id IS NULL;

-- 3. Backfill bay_schedules missing location_id
UPDATE public.bay_schedules bs
SET location_id = l.id
FROM public.locations l
WHERE l.org_id = bs.org_id AND l.is_default = true AND bs.location_id IS NULL;
