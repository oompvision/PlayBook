-- ============================================================
-- 34. Multi-Location Support
-- Adds a locations layer between orgs and their resources.
-- Gated by organizations.locations_enabled flag.
-- ============================================================

-- ============================================================
-- 1. Create locations table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_locations_org_id ON public.locations (org_id);
CREATE INDEX idx_locations_org_active ON public.locations (org_id, is_active);

-- Ensure exactly one default location per org
CREATE UNIQUE INDEX idx_locations_one_default_per_org
  ON public.locations (org_id) WHERE is_default = true;

-- ============================================================
-- 2. Create user_location_preferences table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_location_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  default_location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id)
);

CREATE INDEX idx_user_location_prefs_user_org
  ON public.user_location_preferences (user_id, org_id);

-- ============================================================
-- 3. Add locations_enabled flag to organizations
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS locations_enabled boolean NOT NULL DEFAULT false;

-- ============================================================
-- 4. Insert default location per existing org
-- ============================================================

INSERT INTO public.locations (org_id, name, is_active, is_default)
SELECT id, name, true, true
FROM public.organizations
WHERE NOT EXISTS (
  SELECT 1 FROM public.locations WHERE locations.org_id = organizations.id
);

-- ============================================================
-- 5. Add location_id columns (nullable first, then backfill)
-- ============================================================

-- bays
ALTER TABLE public.bays
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE;

-- bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE;

-- bay_schedule_slots
ALTER TABLE public.bay_schedule_slots
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE;

-- dynamic_schedule_rules
ALTER TABLE public.dynamic_schedule_rules
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE;

-- facility_groups
ALTER TABLE public.facility_groups
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE;

-- schedule_block_outs
ALTER TABLE public.schedule_block_outs
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE;

-- dynamic_rate_overrides
ALTER TABLE public.dynamic_rate_overrides
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE;

-- bay_schedules
ALTER TABLE public.bay_schedules
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE;

-- schedule_templates
ALTER TABLE public.schedule_templates
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE;

-- ============================================================
-- 6. Backfill location_id on all existing rows
-- ============================================================

-- bays: set location_id to the org's default location
UPDATE public.bays b
SET location_id = l.id
FROM public.locations l
WHERE l.org_id = b.org_id AND l.is_default = true AND b.location_id IS NULL;

-- bookings
UPDATE public.bookings bk
SET location_id = l.id
FROM public.locations l
WHERE l.org_id = bk.org_id AND l.is_default = true AND bk.location_id IS NULL;

-- bay_schedule_slots
UPDATE public.bay_schedule_slots bss
SET location_id = l.id
FROM public.locations l
WHERE l.org_id = bss.org_id AND l.is_default = true AND bss.location_id IS NULL;

-- dynamic_schedule_rules
UPDATE public.dynamic_schedule_rules dsr
SET location_id = l.id
FROM public.locations l
WHERE l.org_id = dsr.org_id AND l.is_default = true AND dsr.location_id IS NULL;

-- facility_groups
UPDATE public.facility_groups fg
SET location_id = l.id
FROM public.locations l
WHERE l.org_id = fg.org_id AND l.is_default = true AND fg.location_id IS NULL;

-- schedule_block_outs
UPDATE public.schedule_block_outs sbo
SET location_id = l.id
FROM public.locations l
WHERE l.org_id = sbo.org_id AND l.is_default = true AND sbo.location_id IS NULL;

-- dynamic_rate_overrides
UPDATE public.dynamic_rate_overrides dro
SET location_id = l.id
FROM public.locations l
WHERE l.org_id = dro.org_id AND l.is_default = true AND dro.location_id IS NULL;

-- bay_schedules
UPDATE public.bay_schedules bs
SET location_id = l.id
FROM public.locations l
WHERE l.org_id = bs.org_id AND l.is_default = true AND bs.location_id IS NULL;

-- schedule_templates
UPDATE public.schedule_templates st
SET location_id = l.id
FROM public.locations l
WHERE l.org_id = st.org_id AND l.is_default = true AND st.location_id IS NULL;

-- ============================================================
-- 7. Set location_id columns to NOT NULL
-- ============================================================

ALTER TABLE public.bays ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE public.bay_schedule_slots ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE public.dynamic_schedule_rules ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE public.facility_groups ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE public.schedule_block_outs ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE public.dynamic_rate_overrides ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE public.bay_schedules ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE public.schedule_templates ALTER COLUMN location_id SET NOT NULL;

-- ============================================================
-- 8. Create indexes on location_id columns
-- ============================================================

CREATE INDEX idx_bays_location_id ON public.bays (location_id);
CREATE INDEX idx_bookings_location_id ON public.bookings (location_id);
CREATE INDEX idx_bay_schedule_slots_location_id ON public.bay_schedule_slots (location_id);
CREATE INDEX idx_dynamic_schedule_rules_location_id ON public.dynamic_schedule_rules (location_id);
CREATE INDEX idx_facility_groups_location_id ON public.facility_groups (location_id);
CREATE INDEX idx_schedule_block_outs_location_id ON public.schedule_block_outs (location_id);
CREATE INDEX idx_dynamic_rate_overrides_location_id ON public.dynamic_rate_overrides (location_id);
CREATE INDEX idx_bay_schedules_location_id ON public.bay_schedules (location_id);
CREATE INDEX idx_schedule_templates_location_id ON public.schedule_templates (location_id);

-- ============================================================
-- 9. RLS policies for locations table
-- ============================================================

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

-- Public can read active locations
CREATE POLICY "Anyone can view active locations"
  ON public.locations FOR SELECT
  USING (is_active = true);

-- Org admins can manage locations in their org
CREATE POLICY "Admins can manage org locations"
  ON public.locations FOR ALL
  USING (public.is_org_admin(org_id) OR public.is_super_admin())
  WITH CHECK (public.is_org_admin(org_id) OR public.is_super_admin());

-- Super admins can manage all locations
CREATE POLICY "Super admins have full access to locations"
  ON public.locations FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ============================================================
-- 10. RLS policies for user_location_preferences table
-- ============================================================

ALTER TABLE public.user_location_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read and write their own preferences
CREATE POLICY "Users can manage their own location preferences"
  ON public.user_location_preferences FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Super admins can manage all preferences
CREATE POLICY "Super admins have full access to location preferences"
  ON public.user_location_preferences FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Org admins can view preferences for their org (for customers page)
CREATE POLICY "Admins can view org location preferences"
  ON public.user_location_preferences FOR SELECT
  USING (public.is_org_admin(org_id));

-- ============================================================
-- 11. Helper function: update_locations_enabled
-- Counts active locations for an org and flips the flag.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_locations_enabled(p_org_id uuid)
RETURNS void AS $$
DECLARE
  v_active_count integer;
BEGIN
  SELECT count(*) INTO v_active_count
  FROM public.locations
  WHERE org_id = p_org_id AND is_active = true;

  UPDATE public.organizations
  SET locations_enabled = (v_active_count > 1)
  WHERE id = p_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 12. Trigger: auto-update locations_enabled when locations change
-- ============================================================

CREATE OR REPLACE FUNCTION public.trigger_update_locations_enabled()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.update_locations_enabled(OLD.org_id);
    RETURN OLD;
  ELSE
    PERFORM public.update_locations_enabled(NEW.org_id);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_locations_update_enabled
  AFTER INSERT OR UPDATE OF is_active OR DELETE
  ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_update_locations_enabled();

-- ============================================================
-- 13. Trigger: auto-create default location on new org
-- ============================================================

CREATE OR REPLACE FUNCTION public.trigger_auto_create_default_location()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.locations (org_id, name, is_active, is_default)
  VALUES (NEW.id, NEW.name, true, true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_org_auto_create_location
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_create_default_location();

-- ============================================================
-- 14. Update create_booking RPC — add p_location_id parameter
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_booking(
  p_org_id uuid,
  p_customer_id uuid,
  p_bay_id uuid,
  p_date date,
  p_slot_ids uuid[],
  p_notes text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_slot record;
  v_total_price integer := 0;
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_confirmation_code text;
  v_booking_id uuid;
  v_locked_slots uuid[];
  v_effective_location_id uuid;
BEGIN
  -- Resolve location_id: use provided value, or fall back to org's default location
  IF p_location_id IS NOT NULL THEN
    v_effective_location_id := p_location_id;
  ELSE
    SELECT id INTO v_effective_location_id
    FROM public.locations
    WHERE org_id = p_org_id AND is_default = true
    LIMIT 1;
  END IF;

  IF v_effective_location_id IS NULL THEN
    RAISE EXCEPTION 'No location found for org %', p_org_id;
  END IF;

  -- Lock the requested slots with FOR UPDATE to prevent concurrent bookings
  FOR v_slot IN
    SELECT id, start_time, end_time, price_cents, status
    FROM public.bay_schedule_slots
    WHERE id = ANY(p_slot_ids)
    ORDER BY start_time
    FOR UPDATE
  LOOP
    -- Check each slot is still available
    IF v_slot.status != 'available' THEN
      RAISE EXCEPTION 'Slot % is no longer available (status: %)', v_slot.id, v_slot.status;
    END IF;

    v_total_price := v_total_price + v_slot.price_cents;

    IF v_start_time IS NULL OR v_slot.start_time < v_start_time THEN
      v_start_time := v_slot.start_time;
    END IF;

    IF v_end_time IS NULL OR v_slot.end_time > v_end_time THEN
      v_end_time := v_slot.end_time;
    END IF;

    v_locked_slots := array_append(v_locked_slots, v_slot.id);
  END LOOP;

  -- Verify we found all requested slots
  IF array_length(v_locked_slots, 1) != array_length(p_slot_ids, 1) THEN
    RAISE EXCEPTION 'Some requested slots were not found';
  END IF;

  -- Generate unique confirmation code
  LOOP
    v_confirmation_code := public.generate_confirmation_code();
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.bookings WHERE confirmation_code = v_confirmation_code
    );
  END LOOP;

  -- Create the booking
  INSERT INTO public.bookings (
    org_id, customer_id, bay_id, date,
    start_time, end_time, total_price_cents,
    status, confirmation_code, notes, location_id
  ) VALUES (
    p_org_id, p_customer_id, p_bay_id, p_date,
    v_start_time, v_end_time, v_total_price,
    'confirmed', v_confirmation_code, p_notes, v_effective_location_id
  ) RETURNING id INTO v_booking_id;

  -- Link slots to the booking
  INSERT INTO public.booking_slots (booking_id, bay_schedule_slot_id)
  SELECT v_booking_id, unnest(p_slot_ids);

  -- Mark slots as booked
  UPDATE public.bay_schedule_slots
  SET status = 'booked', updated_at = now()
  WHERE id = ANY(p_slot_ids);

  RETURN json_build_object(
    'booking_id', v_booking_id,
    'confirmation_code', v_confirmation_code,
    'total_price_cents', v_total_price,
    'start_time', v_start_time,
    'end_time', v_end_time
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 15. Update create_guest_booking RPC — add p_location_id parameter
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_guest_booking(
  p_org_id uuid,
  p_bay_id uuid,
  p_date date,
  p_slot_ids uuid[],
  p_guest_name text,
  p_guest_email text DEFAULT NULL,
  p_guest_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_slot record;
  v_total_price integer := 0;
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_confirmation_code text;
  v_booking_id uuid;
  v_locked_slots uuid[];
  v_claim_token text;
  v_effective_location_id uuid;
BEGIN
  -- Only org admins or super admins can create guest bookings
  IF NOT (public.is_org_admin(p_org_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Only admins can create guest bookings';
  END IF;

  -- Resolve location_id
  IF p_location_id IS NOT NULL THEN
    v_effective_location_id := p_location_id;
  ELSE
    SELECT id INTO v_effective_location_id
    FROM public.locations
    WHERE org_id = p_org_id AND is_default = true
    LIMIT 1;
  END IF;

  IF v_effective_location_id IS NULL THEN
    RAISE EXCEPTION 'No location found for org %', p_org_id;
  END IF;

  -- Lock the requested slots with FOR UPDATE to prevent concurrent bookings
  FOR v_slot IN
    SELECT id, start_time, end_time, price_cents, status
    FROM public.bay_schedule_slots
    WHERE id = ANY(p_slot_ids)
    ORDER BY start_time
    FOR UPDATE
  LOOP
    IF v_slot.status != 'available' THEN
      RAISE EXCEPTION 'Slot % is no longer available (status: %)', v_slot.id, v_slot.status;
    END IF;

    v_total_price := v_total_price + v_slot.price_cents;

    IF v_start_time IS NULL OR v_slot.start_time < v_start_time THEN
      v_start_time := v_slot.start_time;
    END IF;

    IF v_end_time IS NULL OR v_slot.end_time > v_end_time THEN
      v_end_time := v_slot.end_time;
    END IF;

    v_locked_slots := array_append(v_locked_slots, v_slot.id);
  END LOOP;

  -- Verify we found all requested slots
  IF array_length(v_locked_slots, 1) != array_length(p_slot_ids, 1) THEN
    RAISE EXCEPTION 'Some requested slots were not found';
  END IF;

  -- Generate unique confirmation code
  LOOP
    v_confirmation_code := public.generate_confirmation_code();
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.bookings WHERE confirmation_code = v_confirmation_code
    );
  END LOOP;

  -- Generate unique claim token (for guest signup linking)
  v_claim_token := encode(gen_random_bytes(16), 'hex');

  -- Create the guest booking
  INSERT INTO public.bookings (
    org_id, customer_id, bay_id, date,
    start_time, end_time, total_price_cents,
    status, confirmation_code, notes,
    is_guest, guest_name, guest_email, guest_phone,
    claim_token, location_id
  ) VALUES (
    p_org_id, NULL, p_bay_id, p_date,
    v_start_time, v_end_time, v_total_price,
    'confirmed', v_confirmation_code, p_notes,
    true, p_guest_name, p_guest_email, p_guest_phone,
    v_claim_token, v_effective_location_id
  ) RETURNING id INTO v_booking_id;

  -- Link slots to the booking
  INSERT INTO public.booking_slots (booking_id, bay_schedule_slot_id)
  SELECT v_booking_id, unnest(p_slot_ids);

  -- Mark slots as booked
  UPDATE public.bay_schedule_slots
  SET status = 'booked', updated_at = now()
  WHERE id = ANY(p_slot_ids);

  RETURN json_build_object(
    'booking_id', v_booking_id,
    'confirmation_code', v_confirmation_code,
    'total_price_cents', v_total_price,
    'start_time', v_start_time,
    'end_time', v_end_time,
    'claim_token', v_claim_token
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 16. Update create_dynamic_booking RPC — add p_location_id parameter
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_dynamic_booking(
  p_org_id uuid,
  p_customer_id uuid,
  p_bay_id uuid,
  p_date date,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_price_cents integer,
  p_notes text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_booking_id uuid;
  v_confirmation_code text;
  v_conflict_count integer;
  v_effective_location_id uuid;
BEGIN
  -- Resolve location_id
  IF p_location_id IS NOT NULL THEN
    v_effective_location_id := p_location_id;
  ELSE
    SELECT id INTO v_effective_location_id
    FROM public.locations
    WHERE org_id = p_org_id AND is_default = true
    LIMIT 1;
  END IF;

  IF v_effective_location_id IS NULL THEN
    RAISE EXCEPTION 'No location found for org %', p_org_id;
  END IF;

  -- Lock existing confirmed bookings for this bay+date to prevent race conditions
  PERFORM id FROM public.bookings
    WHERE bay_id = p_bay_id
      AND date = p_date
      AND status = 'confirmed'
    FOR UPDATE;

  -- Check for overlapping bookings
  SELECT count(*) INTO v_conflict_count
    FROM public.bookings
    WHERE bay_id = p_bay_id
      AND date = p_date
      AND status = 'confirmed'
      AND start_time < p_end_time
      AND end_time > p_start_time;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Time slot is no longer available';
  END IF;

  -- Generate unique confirmation code
  LOOP
    v_confirmation_code := public.generate_confirmation_code();
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.bookings WHERE confirmation_code = v_confirmation_code
    );
  END LOOP;

  -- Insert the booking
  INSERT INTO public.bookings (
    id, org_id, customer_id, bay_id, date,
    start_time, end_time, total_price_cents,
    status, confirmation_code, notes, location_id
  ) VALUES (
    gen_random_uuid(), p_org_id, p_customer_id, p_bay_id, p_date,
    p_start_time, p_end_time, p_price_cents,
    'confirmed', v_confirmation_code, p_notes, v_effective_location_id
  ) RETURNING id INTO v_booking_id;

  RETURN json_build_object(
    'booking_id', v_booking_id,
    'confirmation_code', v_confirmation_code,
    'total_price_cents', p_price_cents,
    'start_time', p_start_time,
    'end_time', p_end_time
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
