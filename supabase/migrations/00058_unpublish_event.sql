-- ============================================================
-- 58. Add unpublish_event function + event_cancelled notification type
-- Reverses publish_event: releases held slots/blockouts, sets status to draft.
-- If registrations exist, cancels them so notification logic can inform registrants.
-- ============================================================

CREATE OR REPLACE FUNCTION public.unpublish_event(
  p_event_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event RECORD;
  v_released_slots INTEGER := 0;
  v_cancelled_registrations INTEGER := 0;
BEGIN
  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_event.status != 'published' THEN
    RAISE EXCEPTION 'Only published events can be unpublished';
  END IF;

  -- Release held bay schedule slots
  UPDATE public.bay_schedule_slots
  SET status = 'available', event_id = NULL, updated_at = NOW()
  WHERE event_id = p_event_id AND status = 'event_hold';
  GET DIAGNOSTICS v_released_slots = ROW_COUNT;

  -- Remove schedule block-outs (for dynamic scheduling)
  DELETE FROM public.schedule_block_outs
  WHERE event_id = p_event_id;

  -- Cancel active registrations
  UPDATE public.event_registrations
  SET status = 'cancelled', cancelled_at = NOW()
  WHERE event_id = p_event_id
    AND status IN ('confirmed', 'waitlisted', 'pending_payment');
  GET DIAGNOSTICS v_cancelled_registrations = ROW_COUNT;

  -- Set event back to draft
  UPDATE public.events
  SET status = 'draft', updated_at = NOW()
  WHERE id = p_event_id;

  RETURN json_build_object(
    'status', 'draft',
    'released_slots', v_released_slots,
    'cancelled_registrations', v_cancelled_registrations
  );
END;
$$;
