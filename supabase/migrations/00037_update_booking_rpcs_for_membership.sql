-- ============================================================
-- 37. Update booking RPCs for membership support
-- - create_booking: use get_effective_bookable_window(), add discount params
-- - create_dynamic_booking: add bookable window enforcement + discount params
-- ============================================================

-- ============================================================
-- 1. Update create_booking — membership-aware window + discount
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_booking(
  p_org_id uuid,
  p_customer_id uuid,
  p_bay_id uuid,
  p_date date,
  p_slot_ids uuid[],
  p_notes text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_discount_cents integer DEFAULT 0,
  p_discount_description text DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_slot record;
  v_locked_slots uuid[];
  v_group_start timestamptz;
  v_group_end timestamptz;
  v_group_price integer;
  v_group_slot_ids uuid[];
  v_confirmation_code text;
  v_booking_id uuid;
  v_results json[] := '{}';
  v_org record;
  v_today date;
  v_max_date date;
  v_effective_window integer;
BEGIN
  -- Look up org settings
  SELECT timezone, bookable_window_days
  INTO v_org
  FROM public.organizations
  WHERE id = p_org_id;

  -- Compute today in org timezone
  v_today := (now() AT TIME ZONE COALESCE(v_org.timezone, 'America/New_York'))::date;

  -- Use membership-aware bookable window
  v_effective_window := public.get_effective_bookable_window(p_org_id, p_customer_id);
  v_max_date := v_today + v_effective_window;

  -- Validate date is within bookable window
  IF p_date < v_today THEN
    RAISE EXCEPTION 'Cannot book in the past';
  END IF;
  IF p_date > v_max_date THEN
    RAISE EXCEPTION 'Cannot book more than % days in advance', v_effective_window;
  END IF;

  -- Lock the requested slots with FOR UPDATE to prevent concurrent bookings
  -- and collect them into an array ordered by start_time
  v_locked_slots := '{}';
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
    v_locked_slots := array_append(v_locked_slots, v_slot.id);
  END LOOP;

  -- Verify we found all requested slots
  IF array_length(v_locked_slots, 1) IS DISTINCT FROM array_length(p_slot_ids, 1) THEN
    RAISE EXCEPTION 'Some requested slots were not found';
  END IF;

  -- Now iterate ordered slots, grouping consecutive ones
  v_group_start := NULL;
  v_group_end := NULL;
  v_group_price := 0;
  v_group_slot_ids := '{}';

  FOR v_slot IN
    SELECT id, start_time, end_time, price_cents
    FROM public.bay_schedule_slots
    WHERE id = ANY(p_slot_ids)
    ORDER BY start_time
  LOOP
    -- If this slot is not consecutive with the current group, flush the group
    IF v_group_end IS NOT NULL AND v_slot.start_time > v_group_end THEN
      -- Generate unique confirmation code
      LOOP
        v_confirmation_code := public.generate_confirmation_code();
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.bookings WHERE confirmation_code = v_confirmation_code
        );
      END LOOP;

      -- Create booking for current group
      INSERT INTO public.bookings (
        org_id, customer_id, bay_id, date,
        start_time, end_time, total_price_cents,
        status, confirmation_code, notes,
        location_id, discount_cents, discount_description
      ) VALUES (
        p_org_id, p_customer_id, p_bay_id, p_date,
        v_group_start, v_group_end, v_group_price,
        'confirmed', v_confirmation_code, p_notes,
        p_location_id, p_discount_cents, p_discount_description
      ) RETURNING id INTO v_booking_id;

      INSERT INTO public.booking_slots (booking_id, bay_schedule_slot_id)
      SELECT v_booking_id, unnest(v_group_slot_ids);

      UPDATE public.bay_schedule_slots
      SET status = 'booked', updated_at = now()
      WHERE id = ANY(v_group_slot_ids);

      v_results := array_append(v_results, json_build_object(
        'booking_id', v_booking_id,
        'confirmation_code', v_confirmation_code,
        'total_price_cents', v_group_price,
        'start_time', v_group_start,
        'end_time', v_group_end
      ));

      -- Reset group
      v_group_start := NULL;
      v_group_end := NULL;
      v_group_price := 0;
      v_group_slot_ids := '{}';
    END IF;

    -- Add slot to current group
    IF v_group_start IS NULL THEN
      v_group_start := v_slot.start_time;
    END IF;
    v_group_end := v_slot.end_time;
    v_group_price := v_group_price + v_slot.price_cents;
    v_group_slot_ids := array_append(v_group_slot_ids, v_slot.id);
  END LOOP;

  -- Flush the last group
  IF v_group_start IS NOT NULL THEN
    LOOP
      v_confirmation_code := public.generate_confirmation_code();
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.bookings WHERE confirmation_code = v_confirmation_code
      );
    END LOOP;

    INSERT INTO public.bookings (
      org_id, customer_id, bay_id, date,
      start_time, end_time, total_price_cents,
      status, confirmation_code, notes,
      location_id, discount_cents, discount_description
    ) VALUES (
      p_org_id, p_customer_id, p_bay_id, p_date,
      v_group_start, v_group_end, v_group_price,
      'confirmed', v_confirmation_code, p_notes,
      p_location_id, p_discount_cents, p_discount_description
    ) RETURNING id INTO v_booking_id;

    INSERT INTO public.booking_slots (booking_id, bay_schedule_slot_id)
    SELECT v_booking_id, unnest(v_group_slot_ids);

    UPDATE public.bay_schedule_slots
    SET status = 'booked', updated_at = now()
    WHERE id = ANY(v_group_slot_ids);

    v_results := array_append(v_results, json_build_object(
      'booking_id', v_booking_id,
      'confirmation_code', v_confirmation_code,
      'total_price_cents', v_group_price,
      'start_time', v_group_start,
      'end_time', v_group_end
    ));
  END IF;

  -- Return results: single object for backwards compat when 1 group,
  -- or array when multiple groups
  IF array_length(v_results, 1) = 1 THEN
    RETURN v_results[1];
  ELSE
    RETURN array_to_json(v_results);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 2. Update create_dynamic_booking — add window enforcement + discount
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
  p_location_id uuid DEFAULT NULL,
  p_discount_cents integer DEFAULT 0,
  p_discount_description text DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_booking_id uuid;
  v_confirmation_code text;
  v_conflict_count integer;
  v_effective_location_id uuid;
  v_org record;
  v_today date;
  v_max_date date;
  v_effective_window integer;
BEGIN
  -- Look up org settings
  SELECT timezone
  INTO v_org
  FROM public.organizations
  WHERE id = p_org_id;

  -- Compute today in org timezone
  v_today := (now() AT TIME ZONE COALESCE(v_org.timezone, 'America/New_York'))::date;

  -- Use membership-aware bookable window
  v_effective_window := public.get_effective_bookable_window(p_org_id, p_customer_id);
  v_max_date := v_today + v_effective_window;

  -- Validate date is within bookable window
  IF p_date < v_today THEN
    RAISE EXCEPTION 'Cannot book in the past';
  END IF;
  IF p_date > v_max_date THEN
    RAISE EXCEPTION 'Cannot book more than % days in advance', v_effective_window;
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
    status, confirmation_code, notes, location_id,
    discount_cents, discount_description
  ) VALUES (
    gen_random_uuid(), p_org_id, p_customer_id, p_bay_id, p_date,
    p_start_time, p_end_time, p_price_cents,
    'confirmed', v_confirmation_code, p_notes, v_effective_location_id,
    p_discount_cents, p_discount_description
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
