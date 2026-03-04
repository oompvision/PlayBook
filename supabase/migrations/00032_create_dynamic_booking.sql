-- ============================================================
-- Atomic dynamic booking function with row-level locking
-- For dynamic scheduling mode: no bay_schedule_slots involved.
-- Locks existing bookings for the bay+date, checks for time
-- overlap, then inserts the booking.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_dynamic_booking(
  p_org_id uuid,
  p_customer_id uuid,
  p_bay_id uuid,
  p_date date,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_price_cents integer,
  p_notes text DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_booking_id uuid;
  v_confirmation_code text;
  v_conflict_count integer;
BEGIN
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

  -- Generate unique confirmation code (same generator as slot-based bookings)
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
    status, confirmation_code, notes
  ) VALUES (
    gen_random_uuid(), p_org_id, p_customer_id, p_bay_id, p_date,
    p_start_time, p_end_time, p_price_cents,
    'confirmed', v_confirmation_code, p_notes
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
