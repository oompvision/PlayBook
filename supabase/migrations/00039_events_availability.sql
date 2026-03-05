-- ============================================================
-- 39. Events — Availability Blocking & Registration
-- ALTER bay_schedule_slots status, add event_id columns,
-- RPC functions for publishing, registration, and cancellation
-- ============================================================

-- ============================================================
-- 39a. ALTER bay_schedule_slots — add event_hold status + event_id
-- ============================================================

-- Drop and recreate the CHECK constraint to add 'event_hold'
ALTER TABLE public.bay_schedule_slots
  DROP CONSTRAINT IF EXISTS bay_schedule_slots_status_check;

ALTER TABLE public.bay_schedule_slots
  ADD CONSTRAINT bay_schedule_slots_status_check
  CHECK (status IN ('available', 'booked', 'blocked', 'event_hold'));

-- Add event_id column to trace which event holds a slot
ALTER TABLE public.bay_schedule_slots
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bay_schedule_slots_event
  ON public.bay_schedule_slots (event_id) WHERE event_id IS NOT NULL;

-- ============================================================
-- 39b. Add event_id to schedule_block_outs (for dynamic orgs)
-- ============================================================

ALTER TABLE public.schedule_block_outs
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.events(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_schedule_block_outs_event
  ON public.schedule_block_outs (event_id) WHERE event_id IS NOT NULL;

-- ============================================================
-- 39c. check_event_conflicts — preview conflicts before publish
-- Returns count of available slots and confirmed bookings that
-- would be affected by publishing this event.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_event_conflicts(p_event_id UUID)
RETURNS JSON AS $$
DECLARE
  v_event RECORD;
  v_bay_ids UUID[];
  v_affected_slots INTEGER := 0;
  v_affected_bookings INTEGER := 0;
BEGIN
  -- Get the event
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  -- Get assigned bay IDs
  SELECT ARRAY_AGG(bay_id) INTO v_bay_ids
  FROM public.event_bays WHERE event_id = p_event_id;

  IF v_bay_ids IS NULL OR array_length(v_bay_ids, 1) IS NULL THEN
    RETURN json_build_object('affected_slots', 0, 'affected_bookings', 0);
  END IF;

  -- Count available slots that overlap with event time range
  SELECT COUNT(*) INTO v_affected_slots
  FROM public.bay_schedule_slots bss
  JOIN public.bay_schedules bs ON bss.bay_schedule_id = bs.id
  WHERE bs.bay_id = ANY(v_bay_ids)
    AND bss.status = 'available'
    AND bss.start_time < v_event.end_time
    AND bss.end_time > v_event.start_time;

  -- Count confirmed bookings that overlap with event time range
  SELECT COUNT(DISTINCT b.id) INTO v_affected_bookings
  FROM public.bookings b
  WHERE b.bay_id = ANY(v_bay_ids)
    AND b.status = 'confirmed'
    AND b.start_time < v_event.end_time
    AND b.end_time > v_event.start_time;

  RETURN json_build_object(
    'affected_slots', v_affected_slots,
    'affected_bookings', v_affected_bookings
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 39d. publish_event — atomically publish an event
-- Marks overlapping slots as event_hold, creates block-outs for
-- dynamic orgs, changes event status to published.
-- ============================================================

CREATE OR REPLACE FUNCTION public.publish_event(
  p_event_id UUID,
  p_cancel_conflicting_bookings BOOLEAN DEFAULT FALSE
)
RETURNS JSON AS $$
DECLARE
  v_event RECORD;
  v_org RECORD;
  v_bay_ids UUID[];
  v_affected_slots INTEGER := 0;
  v_cancelled_bookings INTEGER := 0;
  v_bay_id UUID;
BEGIN
  -- Get and lock the event
  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_event.status != 'draft' THEN
    RAISE EXCEPTION 'Only draft events can be published';
  END IF;

  -- Get org scheduling type
  SELECT * INTO v_org
  FROM public.organizations
  WHERE id = v_event.org_id;

  -- Get assigned bay IDs
  SELECT ARRAY_AGG(bay_id) INTO v_bay_ids
  FROM public.event_bays WHERE event_id = p_event_id;

  IF v_bay_ids IS NULL OR array_length(v_bay_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Event must have at least one facility assigned';
  END IF;

  -- Handle slot-based orgs: mark overlapping available slots as event_hold
  IF v_org.scheduling_type = 'slot_based' THEN
    -- Mark available slots as event_hold
    UPDATE public.bay_schedule_slots bss
    SET status = 'event_hold', event_id = p_event_id, updated_at = NOW()
    FROM public.bay_schedules bs
    WHERE bss.bay_schedule_id = bs.id
      AND bs.bay_id = ANY(v_bay_ids)
      AND bss.status = 'available'
      AND bss.start_time < v_event.end_time
      AND bss.end_time > v_event.start_time;

    GET DIAGNOSTICS v_affected_slots = ROW_COUNT;

    -- Cancel conflicting bookings if admin confirmed
    IF p_cancel_conflicting_bookings THEN
      -- Get booking IDs that conflict
      WITH conflicting AS (
        SELECT DISTINCT b.id
        FROM public.bookings b
        WHERE b.bay_id = ANY(v_bay_ids)
          AND b.status = 'confirmed'
          AND b.start_time < v_event.end_time
          AND b.end_time > v_event.start_time
      )
      UPDATE public.bookings
      SET status = 'cancelled', updated_at = NOW()
      WHERE id IN (SELECT id FROM conflicting);

      GET DIAGNOSTICS v_cancelled_bookings = ROW_COUNT;

      -- Also mark those slots as event_hold (they were 'booked')
      UPDATE public.bay_schedule_slots bss
      SET status = 'event_hold', event_id = p_event_id, updated_at = NOW()
      FROM public.bay_schedules bs
      WHERE bss.bay_schedule_id = bs.id
        AND bs.bay_id = ANY(v_bay_ids)
        AND bss.status = 'booked'
        AND bss.start_time < v_event.end_time
        AND bss.end_time > v_event.start_time;

      -- Clean up booking_slots junction for cancelled bookings
      DELETE FROM public.booking_slots
      WHERE booking_id IN (
        SELECT id FROM public.bookings
        WHERE bay_id = ANY(v_bay_ids)
          AND status = 'cancelled'
          AND start_time < v_event.end_time
          AND end_time > v_event.start_time
      );
    END IF;
  END IF;

  -- Handle dynamic orgs: create block-outs for each bay
  IF v_org.scheduling_type = 'dynamic' THEN
    FOREACH v_bay_id IN ARRAY v_bay_ids LOOP
      INSERT INTO public.schedule_block_outs (
        bay_id, org_id, date, start_time, end_time, reason, event_id
      ) VALUES (
        v_bay_id,
        v_event.org_id,
        v_event.start_time::date,
        v_event.start_time,
        v_event.end_time,
        'Event: ' || v_event.name,
        p_event_id
      );
    END LOOP;
  END IF;

  -- Update event status to published
  UPDATE public.events
  SET status = 'published', updated_at = NOW()
  WHERE id = p_event_id;

  RETURN json_build_object(
    'status', 'published',
    'affected_slots', v_affected_slots,
    'cancelled_bookings', v_cancelled_bookings
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 39e. cancel_event — cancel a published event
-- Releases held slots, removes block-outs, cancels registrations.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_event(p_event_id UUID)
RETURNS JSON AS $$
DECLARE
  v_event RECORD;
  v_released_slots INTEGER := 0;
  v_cancelled_registrations INTEGER := 0;
BEGIN
  -- Get and lock the event
  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  -- Release event_hold slots back to available
  UPDATE public.bay_schedule_slots
  SET status = 'available', event_id = NULL, updated_at = NOW()
  WHERE event_id = p_event_id AND status = 'event_hold';

  GET DIAGNOSTICS v_released_slots = ROW_COUNT;

  -- Remove block-outs for dynamic orgs
  DELETE FROM public.schedule_block_outs
  WHERE event_id = p_event_id;

  -- Cancel all active registrations
  UPDATE public.event_registrations
  SET status = 'cancelled', cancelled_at = NOW()
  WHERE event_id = p_event_id AND status IN ('confirmed', 'waitlisted', 'pending_payment');

  GET DIAGNOSTICS v_cancelled_registrations = ROW_COUNT;

  -- Update event status
  UPDATE public.events
  SET status = 'cancelled', updated_at = NOW()
  WHERE id = p_event_id;

  RETURN json_build_object(
    'status', 'cancelled',
    'released_slots', v_released_slots,
    'cancelled_registrations', v_cancelled_registrations
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 39f. register_for_event — atomic registration with capacity check
-- Uses SELECT FOR UPDATE on event row for concurrency safety.
-- ============================================================

CREATE OR REPLACE FUNCTION public.register_for_event(
  p_event_id UUID,
  p_user_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_event RECORD;
  v_current_count INTEGER;
  v_registration_id UUID;
  v_status TEXT;
  v_waitlist_pos INTEGER;
BEGIN
  -- Lock the event row for concurrent registration safety
  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_event.status != 'published' THEN
    RAISE EXCEPTION 'Event is not open for registration';
  END IF;

  -- Check for existing active registration
  IF EXISTS (
    SELECT 1 FROM public.event_registrations
    WHERE event_id = p_event_id
      AND user_id = p_user_id
      AND status IN ('confirmed', 'waitlisted', 'pending_payment')
  ) THEN
    RAISE EXCEPTION 'Already registered for this event';
  END IF;

  -- Get current registration count
  SELECT COUNT(*) INTO v_current_count
  FROM public.event_registrations
  WHERE event_id = p_event_id
    AND status IN ('confirmed', 'pending_payment');

  -- Determine status: confirmed if spots available, waitlisted if full
  IF v_current_count < v_event.capacity THEN
    -- Check if paid event → pending_payment, otherwise confirmed
    IF v_event.price_cents > 0 THEN
      v_status := 'pending_payment';
    ELSE
      v_status := 'confirmed';
    END IF;
    v_waitlist_pos := NULL;
  ELSE
    v_status := 'waitlisted';
    -- Get next waitlist position
    SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_pos
    FROM public.event_registrations
    WHERE event_id = p_event_id AND status = 'waitlisted';
  END IF;

  -- Insert registration (upsert in case of previous cancellation)
  INSERT INTO public.event_registrations (
    event_id, user_id, org_id, status, waitlist_position, registered_at,
    payment_status, cancelled_at, promoted_at, promotion_expires_at
  ) VALUES (
    p_event_id, p_user_id, v_event.org_id, v_status, v_waitlist_pos, NOW(),
    CASE WHEN v_status = 'pending_payment' THEN 'pending' ELSE NULL END,
    NULL, NULL, NULL
  )
  ON CONFLICT (event_id, user_id) DO UPDATE SET
    status = EXCLUDED.status,
    waitlist_position = EXCLUDED.waitlist_position,
    registered_at = NOW(),
    payment_status = EXCLUDED.payment_status,
    cancelled_at = NULL,
    promoted_at = NULL,
    promotion_expires_at = NULL
  RETURNING id INTO v_registration_id;

  RETURN json_build_object(
    'registration_id', v_registration_id,
    'status', v_status,
    'waitlist_position', v_waitlist_pos,
    'event_name', v_event.name,
    'price_cents', v_event.price_cents
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 39g. cancel_event_registration — cancel a registration
-- Frees the spot and auto-promotes next waitlisted user.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_event_registration(p_registration_id UUID)
RETURNS JSON AS $$
DECLARE
  v_reg RECORD;
  v_event RECORD;
  v_promoted_reg RECORD;
  v_was_confirmed BOOLEAN;
BEGIN
  -- Lock the registration
  SELECT * INTO v_reg
  FROM public.event_registrations
  WHERE id = p_registration_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found';
  END IF;

  IF v_reg.status = 'cancelled' THEN
    RAISE EXCEPTION 'Registration is already cancelled';
  END IF;

  v_was_confirmed := v_reg.status IN ('confirmed', 'pending_payment');

  -- Cancel the registration
  UPDATE public.event_registrations
  SET status = 'cancelled', cancelled_at = NOW()
  WHERE id = p_registration_id;

  -- Auto-promote next waitlisted user if a confirmed spot was freed
  IF v_was_confirmed THEN
    -- Lock the event for concurrency
    SELECT * INTO v_event
    FROM public.events
    WHERE id = v_reg.event_id
    FOR UPDATE;

    -- Find the next waitlisted user (lowest position)
    SELECT * INTO v_promoted_reg
    FROM public.event_registrations
    WHERE event_id = v_reg.event_id
      AND status = 'waitlisted'
    ORDER BY waitlist_position ASC NULLS LAST, registered_at ASC
    LIMIT 1
    FOR UPDATE;

    IF v_promoted_reg.id IS NOT NULL THEN
      -- Promote: if paid event, set pending_payment with expiry; else confirm
      IF v_event.price_cents > 0 THEN
        UPDATE public.event_registrations
        SET status = 'pending_payment',
            waitlist_position = NULL,
            promoted_at = NOW(),
            promotion_expires_at = NOW() + (v_event.waitlist_promotion_hours || ' hours')::interval,
            payment_status = 'pending'
        WHERE id = v_promoted_reg.id;
      ELSE
        UPDATE public.event_registrations
        SET status = 'confirmed',
            waitlist_position = NULL,
            promoted_at = NOW()
        WHERE id = v_promoted_reg.id;
      END IF;

      RETURN json_build_object(
        'cancelled', TRUE,
        'promoted_user_id', v_promoted_reg.user_id,
        'promoted_registration_id', v_promoted_reg.id
      );
    END IF;
  END IF;

  RETURN json_build_object('cancelled', TRUE, 'promoted_user_id', NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 39h. confirm_event_payment — mark registration as paid
-- Called after successful Stripe payment.
-- ============================================================

CREATE OR REPLACE FUNCTION public.confirm_event_payment(
  p_registration_id UUID,
  p_payment_intent_id TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_reg RECORD;
BEGIN
  SELECT * INTO v_reg
  FROM public.event_registrations
  WHERE id = p_registration_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found';
  END IF;

  IF v_reg.status != 'pending_payment' THEN
    RAISE EXCEPTION 'Registration is not pending payment';
  END IF;

  UPDATE public.event_registrations
  SET status = 'confirmed',
      payment_status = 'paid',
      payment_intent_id = COALESCE(p_payment_intent_id, payment_intent_id)
  WHERE id = p_registration_id;

  RETURN json_build_object('confirmed', TRUE, 'registration_id', p_registration_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
