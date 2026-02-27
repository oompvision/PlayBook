-- ============================================================
-- 26. Guest Booking Claim Token
-- Allows guests to claim their booking when they sign up.
-- ============================================================

-- Add claim_token column
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS claim_token text UNIQUE;

-- Create index for claim lookups
CREATE INDEX IF NOT EXISTS idx_bookings_claim_token
  ON public.bookings (claim_token) WHERE claim_token IS NOT NULL;

-- Update create_guest_booking to generate claim token
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
  v_claim_token text;
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

  -- Generate unique claim token (for guest signup linking)
  v_claim_token := encode(gen_random_bytes(16), 'hex');

  -- Create the guest booking
  INSERT INTO public.bookings (
    org_id, customer_id, bay_id, date,
    start_time, end_time, total_price_cents,
    status, confirmation_code, notes,
    is_guest, guest_name, guest_email, guest_phone,
    claim_token
  ) VALUES (
    p_org_id, NULL, p_bay_id, p_date,
    v_start_time, v_end_time, v_total_price,
    'confirmed', v_confirmation_code, p_notes,
    true, p_guest_name, p_guest_email, p_guest_phone,
    v_claim_token
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
-- Function to claim a guest booking after signup
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_guest_booking(p_claim_token text)
RETURNS json AS $$
DECLARE
  v_booking record;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated to claim a booking';
  END IF;

  -- Find the guest booking by claim token
  SELECT id, org_id, is_guest, customer_id, claim_token, confirmation_code
  INTO v_booking
  FROM public.bookings
  WHERE claim_token = p_claim_token
    AND is_guest = true
    AND customer_id IS NULL
  FOR UPDATE;

  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'No claimable booking found for this token';
  END IF;

  -- Link the booking to the authenticated user
  UPDATE public.bookings
  SET customer_id = v_user_id,
      is_guest = false,
      claim_token = NULL,
      updated_at = now()
  WHERE id = v_booking.id;

  RETURN json_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'confirmation_code', v_booking.confirmation_code
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
