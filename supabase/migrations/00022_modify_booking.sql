-- ============================================================
-- 22. Modify Booking Support
-- Adds modified_from column to track booking modifications,
-- and atomic modify_booking / modify_guest_booking RPCs.
-- ============================================================

-- Add modified_from column to bookings (links new booking to the one it replaced)
ALTER TABLE public.bookings ADD COLUMN modified_from uuid REFERENCES public.bookings(id);

-- Index for looking up modification history
CREATE INDEX IF NOT EXISTS idx_bookings_modified_from ON public.bookings (modified_from) WHERE modified_from IS NOT NULL;

-- ============================================================
-- Atomic modify_booking function (for registered customers)
-- Cancels old booking, creates new one in a single transaction.
-- ============================================================

CREATE OR REPLACE FUNCTION public.modify_booking(
  p_booking_id uuid,
  p_new_bay_id uuid,
  p_new_date date,
  p_new_slot_ids uuid[],
  p_notes text DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_old_booking record;
  v_slot record;
  v_total_price integer := 0;
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_confirmation_code text;
  v_new_booking_id uuid;
  v_locked_slots uuid[];
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

  IF v_old_booking.is_guest THEN
    RAISE EXCEPTION 'Use modify_guest_booking for guest bookings';
  END IF;

  -- Free the old booking's slots first (so they can be re-selected if needed)
  UPDATE public.bay_schedule_slots
  SET status = 'available', updated_at = now()
  WHERE id IN (
    SELECT bay_schedule_slot_id FROM public.booking_slots
    WHERE booking_id = p_booking_id
  );

  -- Lock the new requested slots with FOR UPDATE
  FOR v_slot IN
    SELECT id, start_time, end_time, price_cents, status
    FROM public.bay_schedule_slots
    WHERE id = ANY(p_new_slot_ids)
    ORDER BY start_time
    FOR UPDATE
  LOOP
    IF v_slot.status != 'available' THEN
      -- Rollback: re-book old slots before raising
      UPDATE public.bay_schedule_slots
      SET status = 'booked', updated_at = now()
      WHERE id IN (
        SELECT bay_schedule_slot_id FROM public.booking_slots
        WHERE booking_id = p_booking_id
      );
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
  IF array_length(v_locked_slots, 1) != array_length(p_new_slot_ids, 1) THEN
    -- Rollback: re-book old slots
    UPDATE public.bay_schedule_slots
    SET status = 'booked', updated_at = now()
    WHERE id IN (
      SELECT bay_schedule_slot_id FROM public.booking_slots
      WHERE booking_id = p_booking_id
    );
    RAISE EXCEPTION 'Some requested slots were not found';
  END IF;

  -- Generate unique confirmation code for the new booking
  LOOP
    v_confirmation_code := public.generate_confirmation_code();
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.bookings WHERE confirmation_code = v_confirmation_code
    );
  END LOOP;

  -- Create the new booking with modified_from reference
  INSERT INTO public.bookings (
    org_id, customer_id, bay_id, date,
    start_time, end_time, total_price_cents,
    status, confirmation_code, notes, modified_from
  ) VALUES (
    v_old_booking.org_id, v_old_booking.customer_id, p_new_bay_id, p_new_date,
    v_start_time, v_end_time, v_total_price,
    'confirmed', v_confirmation_code, p_notes, p_booking_id
  ) RETURNING id INTO v_new_booking_id;

  -- Link new slots to the new booking
  INSERT INTO public.booking_slots (booking_id, bay_schedule_slot_id)
  SELECT v_new_booking_id, unnest(p_new_slot_ids);

  -- Mark new slots as booked
  UPDATE public.bay_schedule_slots
  SET status = 'booked', updated_at = now()
  WHERE id = ANY(p_new_slot_ids);

  -- Cancel the old booking (slots already freed above)
  UPDATE public.bookings
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_booking_id;

  RETURN json_build_object(
    'booking_id', v_new_booking_id,
    'confirmation_code', v_confirmation_code,
    'total_price_cents', v_total_price,
    'start_time', v_start_time,
    'end_time', v_end_time,
    'old_confirmation_code', v_old_booking.confirmation_code
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Atomic modify_guest_booking function
-- Same as modify_booking but carries over guest info.
-- ============================================================

CREATE OR REPLACE FUNCTION public.modify_guest_booking(
  p_booking_id uuid,
  p_new_bay_id uuid,
  p_new_date date,
  p_new_slot_ids uuid[],
  p_notes text DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_old_booking record;
  v_slot record;
  v_total_price integer := 0;
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_confirmation_code text;
  v_new_booking_id uuid;
  v_locked_slots uuid[];
BEGIN
  -- Only org admins or super admins can modify guest bookings
  SELECT id, org_id, customer_id, bay_id, date, start_time, end_time,
         total_price_cents, status, confirmation_code, is_guest,
         guest_name, guest_email, guest_phone
  INTO v_old_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF v_old_booking IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_old_booking.status != 'confirmed' THEN
    RAISE EXCEPTION 'Cannot modify a cancelled booking';
  END IF;

  IF NOT v_old_booking.is_guest THEN
    RAISE EXCEPTION 'Use modify_booking for registered customer bookings';
  END IF;

  IF NOT (public.is_org_admin(v_old_booking.org_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Only admins can modify guest bookings';
  END IF;

  -- Free the old booking's slots first
  UPDATE public.bay_schedule_slots
  SET status = 'available', updated_at = now()
  WHERE id IN (
    SELECT bay_schedule_slot_id FROM public.booking_slots
    WHERE booking_id = p_booking_id
  );

  -- Lock the new requested slots
  FOR v_slot IN
    SELECT id, start_time, end_time, price_cents, status
    FROM public.bay_schedule_slots
    WHERE id = ANY(p_new_slot_ids)
    ORDER BY start_time
    FOR UPDATE
  LOOP
    IF v_slot.status != 'available' THEN
      UPDATE public.bay_schedule_slots
      SET status = 'booked', updated_at = now()
      WHERE id IN (
        SELECT bay_schedule_slot_id FROM public.booking_slots
        WHERE booking_id = p_booking_id
      );
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

  IF array_length(v_locked_slots, 1) != array_length(p_new_slot_ids, 1) THEN
    UPDATE public.bay_schedule_slots
    SET status = 'booked', updated_at = now()
    WHERE id IN (
      SELECT bay_schedule_slot_id FROM public.booking_slots
      WHERE booking_id = p_booking_id
    );
    RAISE EXCEPTION 'Some requested slots were not found';
  END IF;

  LOOP
    v_confirmation_code := public.generate_confirmation_code();
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.bookings WHERE confirmation_code = v_confirmation_code
    );
  END LOOP;

  -- Create new guest booking with carried-over guest info
  INSERT INTO public.bookings (
    org_id, customer_id, bay_id, date,
    start_time, end_time, total_price_cents,
    status, confirmation_code, notes,
    is_guest, guest_name, guest_email, guest_phone,
    modified_from
  ) VALUES (
    v_old_booking.org_id, NULL, p_new_bay_id, p_new_date,
    v_start_time, v_end_time, v_total_price,
    'confirmed', v_confirmation_code, p_notes,
    true, v_old_booking.guest_name, v_old_booking.guest_email, v_old_booking.guest_phone,
    p_booking_id
  ) RETURNING id INTO v_new_booking_id;

  INSERT INTO public.booking_slots (booking_id, bay_schedule_slot_id)
  SELECT v_new_booking_id, unnest(p_new_slot_ids);

  UPDATE public.bay_schedule_slots
  SET status = 'booked', updated_at = now()
  WHERE id = ANY(p_new_slot_ids);

  UPDATE public.bookings
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_booking_id;

  RETURN json_build_object(
    'booking_id', v_new_booking_id,
    'confirmation_code', v_confirmation_code,
    'total_price_cents', v_total_price,
    'start_time', v_start_time,
    'end_time', v_end_time,
    'old_confirmation_code', v_old_booking.confirmation_code
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
