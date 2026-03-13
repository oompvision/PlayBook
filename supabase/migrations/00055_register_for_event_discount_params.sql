-- 00055: Add discount parameters to register_for_event
-- Stores discount_cents and discount_description atomically during registration
-- instead of relying on a separate client-side UPDATE that can silently fail.

CREATE OR REPLACE FUNCTION public.register_for_event(
  p_event_id UUID,
  p_user_id UUID,
  p_discount_cents INTEGER DEFAULT 0,
  p_discount_description TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_event RECORD;
  v_current_count INTEGER;
  v_registration_id UUID;
  v_status TEXT;
  v_waitlist_pos INTEGER;
BEGIN
  -- Lazy-expire any overdue pending_payment promotions first
  PERFORM public.expire_event_promotions(p_event_id);

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

  -- Get current registration count (after expiry cleanup)
  SELECT COUNT(*) INTO v_current_count
  FROM public.event_registrations
  WHERE event_id = p_event_id
    AND status IN ('confirmed', 'pending_payment');

  -- Determine status: confirmed if spots available, waitlisted if full
  IF v_current_count < v_event.capacity THEN
    IF v_event.price_cents > 0 THEN
      v_status := 'pending_payment';
    ELSE
      v_status := 'confirmed';
    END IF;
    v_waitlist_pos := NULL;
  ELSE
    v_status := 'waitlisted';
    SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_pos
    FROM public.event_registrations
    WHERE event_id = p_event_id AND status = 'waitlisted';
  END IF;

  -- Insert registration (upsert in case of previous cancellation)
  INSERT INTO public.event_registrations (
    event_id, user_id, org_id, status, waitlist_position, registered_at,
    payment_status, cancelled_at, promoted_at, promotion_expires_at,
    discount_cents, discount_description
  ) VALUES (
    p_event_id, p_user_id, v_event.org_id, v_status, v_waitlist_pos, NOW(),
    CASE WHEN v_status = 'pending_payment' THEN 'pending' ELSE NULL END,
    NULL, NULL, NULL,
    COALESCE(p_discount_cents, 0), p_discount_description
  )
  ON CONFLICT (event_id, user_id) DO UPDATE SET
    status = EXCLUDED.status,
    waitlist_position = EXCLUDED.waitlist_position,
    registered_at = NOW(),
    payment_status = EXCLUDED.payment_status,
    cancelled_at = NULL,
    promoted_at = NULL,
    promotion_expires_at = NULL,
    discount_cents = EXCLUDED.discount_cents,
    discount_description = EXCLUDED.discount_description
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
