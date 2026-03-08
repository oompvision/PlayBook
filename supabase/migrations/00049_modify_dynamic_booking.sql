-- ============================================================
-- 49. Atomic modify_dynamic_booking RPC
-- Cancels old booking + creates new dynamic booking in one transaction.
-- Mirrors modify_booking (00022) but for dynamic-schedule orgs
-- that don't use bay_schedule_slots.
-- ============================================================

CREATE OR REPLACE FUNCTION public.modify_dynamic_booking(
  p_booking_id uuid,
  p_new_bay_id uuid,
  p_new_date date,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_price_cents integer,
  p_notes text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_old_booking record;
  v_booking_id uuid;
  v_confirmation_code text;
  v_conflict_count integer;
  v_effective_location_id uuid;
  v_org record;
  v_today date;
  v_max_date date;
  v_effective_window integer;
BEGIN
  -- Fetch and validate the old booking
  SELECT id, org_id, customer_id, bay_id, date, start_time, end_time,
         total_price_cents, status, confirmation_code, is_guest
  INTO v_old_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF v_old_booking IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_old_booking.status != 'confirmed' THEN
    RAISE EXCEPTION 'Cannot modify a cancelled booking';
  END IF;

  -- Look up org settings
  SELECT timezone
  INTO v_org
  FROM public.organizations
  WHERE id = v_old_booking.org_id;

  -- Compute today in org timezone
  v_today := (now() AT TIME ZONE COALESCE(v_org.timezone, 'America/New_York'))::date;

  -- Use membership-aware bookable window
  v_effective_window := public.get_effective_bookable_window(v_old_booking.org_id, v_old_booking.customer_id);
  v_max_date := v_today + v_effective_window;

  -- Validate date is within bookable window
  IF p_new_date < v_today THEN
    RAISE EXCEPTION 'Cannot book in the past';
  END IF;
  IF p_new_date > v_max_date THEN
    RAISE EXCEPTION 'Cannot book more than % days in advance', v_effective_window;
  END IF;

  -- Resolve location_id
  IF p_location_id IS NOT NULL THEN
    v_effective_location_id := p_location_id;
  ELSE
    SELECT id INTO v_effective_location_id
    FROM public.locations
    WHERE org_id = v_old_booking.org_id AND is_default = true
    LIMIT 1;
  END IF;

  IF v_effective_location_id IS NULL THEN
    RAISE EXCEPTION 'No location found for org %', v_old_booking.org_id;
  END IF;

  -- Cancel the old booking first (frees the time slot for overlap check)
  UPDATE public.bookings
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_booking_id;

  -- Delete any booking_slots junction rows (dynamic bookings may not have these,
  -- but clean up just in case)
  DELETE FROM public.booking_slots
  WHERE booking_id = p_booking_id;

  -- Lock existing confirmed bookings for this bay+date to prevent race conditions
  PERFORM id FROM public.bookings
    WHERE bay_id = p_new_bay_id
      AND date = p_new_date
      AND status = 'confirmed'
    FOR UPDATE;

  -- Check for overlapping bookings (old booking is already cancelled so won't conflict)
  SELECT count(*) INTO v_conflict_count
    FROM public.bookings
    WHERE bay_id = p_new_bay_id
      AND date = p_new_date
      AND status = 'confirmed'
      AND start_time < p_end_time
      AND end_time > p_start_time;

  IF v_conflict_count > 0 THEN
    -- Rollback: un-cancel the old booking
    UPDATE public.bookings
    SET status = 'confirmed', updated_at = now()
    WHERE id = p_booking_id;
    RAISE EXCEPTION 'Time slot is no longer available';
  END IF;

  -- Generate unique confirmation code
  LOOP
    v_confirmation_code := public.generate_confirmation_code();
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.bookings WHERE confirmation_code = v_confirmation_code
    );
  END LOOP;

  -- Insert the new booking with modified_from reference
  INSERT INTO public.bookings (
    id, org_id, customer_id, bay_id, date,
    start_time, end_time, total_price_cents,
    status, confirmation_code, notes, location_id,
    modified_from
  ) VALUES (
    gen_random_uuid(), v_old_booking.org_id, v_old_booking.customer_id,
    p_new_bay_id, p_new_date,
    p_start_time, p_end_time, p_price_cents,
    'confirmed', v_confirmation_code, p_notes, v_effective_location_id,
    p_booking_id
  ) RETURNING id INTO v_booking_id;

  RETURN json_build_object(
    'booking_id', v_booking_id,
    'confirmation_code', v_confirmation_code,
    'total_price_cents', p_price_cents,
    'start_time', p_start_time,
    'end_time', p_end_time,
    'old_confirmation_code', v_old_booking.confirmation_code
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
