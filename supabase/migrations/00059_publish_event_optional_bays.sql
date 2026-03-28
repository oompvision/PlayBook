-- ============================================================
-- 59. Allow publishing events without bay assignments
-- Events like classes/clinics may not need specific bays blocked.
-- The publish_event function now skips slot/blockout logic when
-- no bays are assigned instead of raising an exception.
-- ============================================================

CREATE OR REPLACE FUNCTION public.publish_event(
  p_event_id UUID,
  p_cancel_conflicting_bookings BOOLEAN DEFAULT FALSE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event RECORD;
  v_org RECORD;
  v_bay_ids UUID[];
  v_affected_slots INTEGER := 0;
  v_cancelled_bookings INTEGER := 0;
  v_bay_id UUID;
  v_bay_location_id UUID;
BEGIN
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

  SELECT * INTO v_org
  FROM public.organizations
  WHERE id = v_event.org_id;

  SELECT ARRAY_AGG(bay_id) INTO v_bay_ids
  FROM public.event_bays WHERE event_id = p_event_id;

  -- If bays are assigned, block slots/create blockouts
  IF v_bay_ids IS NOT NULL AND array_length(v_bay_ids, 1) > 0 THEN

    IF v_org.scheduling_type = 'slot_based' THEN
      UPDATE public.bay_schedule_slots bss
      SET status = 'event_hold', event_id = p_event_id, updated_at = NOW()
      FROM public.bay_schedules bs
      WHERE bss.bay_schedule_id = bs.id
        AND bs.bay_id = ANY(v_bay_ids)
        AND bss.status = 'available'
        AND bss.start_time < v_event.end_time
        AND bss.end_time > v_event.start_time;

      GET DIAGNOSTICS v_affected_slots = ROW_COUNT;

      IF p_cancel_conflicting_bookings THEN
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

        UPDATE public.bay_schedule_slots bss
        SET status = 'event_hold', event_id = p_event_id, updated_at = NOW()
        FROM public.bay_schedules bs
        WHERE bss.bay_schedule_id = bs.id
          AND bs.bay_id = ANY(v_bay_ids)
          AND bss.status = 'booked'
          AND bss.start_time < v_event.end_time
          AND bss.end_time > v_event.start_time;

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

    IF v_org.scheduling_type = 'dynamic' THEN
      FOREACH v_bay_id IN ARRAY v_bay_ids LOOP
        SELECT location_id INTO v_bay_location_id
        FROM public.bays
        WHERE id = v_bay_id;

        INSERT INTO public.schedule_block_outs (
          bay_id, org_id, location_id, date, start_time, end_time, reason, event_id
        ) VALUES (
          v_bay_id,
          v_event.org_id,
          v_bay_location_id,
          v_event.start_time::date,
          v_event.start_time,
          v_event.end_time,
          'Event: ' || v_event.name,
          p_event_id
        );
      END LOOP;
    END IF;

  END IF;
  -- If no bays assigned, just publish without blocking anything

  UPDATE public.events
  SET status = 'published', updated_at = NOW()
  WHERE id = p_event_id;

  RETURN json_build_object(
    'status', 'published',
    'affected_slots', v_affected_slots,
    'cancelled_bookings', v_cancelled_bookings
  );
END;
$$;
