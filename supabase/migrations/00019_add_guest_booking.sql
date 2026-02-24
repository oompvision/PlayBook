-- ============================================================
-- 19. Guest Booking Support
-- Allows org admins to create bookings for walk-in / phone-in
-- guests who don't have an ezbooker account.
-- ============================================================

-- Add guest columns to bookings
ALTER TABLE public.bookings ADD COLUMN is_guest boolean NOT NULL DEFAULT false;
ALTER TABLE public.bookings ADD COLUMN guest_name text;
ALTER TABLE public.bookings ADD COLUMN guest_email text;
ALTER TABLE public.bookings ADD COLUMN guest_phone text;

-- Make customer_id nullable (guest bookings have no linked profile)
ALTER TABLE public.bookings ALTER COLUMN customer_id DROP NOT NULL;

-- Ensure data integrity: registered bookings need customer_id, guest bookings need guest_name
ALTER TABLE public.bookings ADD CONSTRAINT bookings_customer_or_guest
  CHECK (
    (is_guest = false AND customer_id IS NOT NULL) OR
    (is_guest = true AND guest_name IS NOT NULL)
  );

-- Index for filtering guest bookings
CREATE INDEX IF NOT EXISTS idx_bookings_is_guest ON public.bookings (is_guest) WHERE is_guest = true;

-- ============================================================
-- Atomic guest booking function (admin-only)
-- Mirrors create_booking but accepts guest info instead of customer_id
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_guest_booking(
  p_org_id uuid,
  p_bay_id uuid,
  p_date date,
  p_slot_ids uuid[],
  p_guest_name text,
  p_guest_email text DEFAULT NULL,
  p_guest_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL
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
BEGIN
  -- Only org admins or super admins can create guest bookings
  IF NOT (public.is_org_admin(p_org_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Only admins can create guest bookings';
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

  -- Create the guest booking
  INSERT INTO public.bookings (
    org_id, customer_id, bay_id, date,
    start_time, end_time, total_price_cents,
    status, confirmation_code, notes,
    is_guest, guest_name, guest_email, guest_phone
  ) VALUES (
    p_org_id, NULL, p_bay_id, p_date,
    v_start_time, v_end_time, v_total_price,
    'confirmed', v_confirmation_code, p_notes,
    true, p_guest_name, p_guest_email, p_guest_phone
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
