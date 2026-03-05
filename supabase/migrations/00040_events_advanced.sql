-- ============================================================
-- 40. Events — Recurring, Templates, Lazy Waitlist Expiry
-- Tables: event_templates
-- Functions: expire_event_promotions, create_recurring_events,
--            update_future_event_instances
-- ============================================================

-- ============================================================
-- 40a. event_templates — reusable event configurations
-- ============================================================

CREATE TABLE IF NOT EXISTS public.event_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_templates_org
  ON public.event_templates (org_id);

CREATE TRIGGER set_event_templates_updated_at
  BEFORE UPDATE ON public.event_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.event_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_templates_admin_all"
  ON public.event_templates FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

CREATE POLICY "event_templates_super_admin_all"
  ON public.event_templates FOR ALL
  USING (public.is_super_admin());

-- ============================================================
-- 40b. expire_event_promotions — lazy expiry (no cron needed)
-- Called at the start of register_for_event and by the events
-- feed query. Expires pending_payment registrations past their
-- promotion_expires_at, then auto-promotes the next waitlisted.
-- ============================================================

CREATE OR REPLACE FUNCTION public.expire_event_promotions(p_event_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_expired RECORD;
  v_event RECORD;
  v_next RECORD;
  v_count INTEGER := 0;
BEGIN
  -- Find all expired pending_payment promotions for this event
  FOR v_expired IN
    SELECT id, user_id
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND status = 'pending_payment'
      AND promotion_expires_at IS NOT NULL
      AND promotion_expires_at < NOW()
    FOR UPDATE
  LOOP
    -- Cancel the expired promotion
    UPDATE public.event_registrations
    SET status = 'cancelled', cancelled_at = NOW()
    WHERE id = v_expired.id;

    v_count := v_count + 1;

    -- Auto-promote next waitlisted user
    SELECT * INTO v_next
    FROM public.event_registrations
    WHERE event_id = p_event_id AND status = 'waitlisted'
    ORDER BY waitlist_position ASC NULLS LAST, registered_at ASC
    LIMIT 1
    FOR UPDATE;

    IF v_next.id IS NOT NULL THEN
      SELECT * INTO v_event
      FROM public.events WHERE id = p_event_id;

      IF v_event.price_cents > 0 THEN
        UPDATE public.event_registrations
        SET status = 'pending_payment',
            waitlist_position = NULL,
            promoted_at = NOW(),
            promotion_expires_at = NOW() + (v_event.waitlist_promotion_hours || ' hours')::interval,
            payment_status = 'pending'
        WHERE id = v_next.id;
      ELSE
        UPDATE public.event_registrations
        SET status = 'confirmed',
            waitlist_position = NULL,
            promoted_at = NOW()
        WHERE id = v_next.id;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 40c. Update register_for_event to call lazy expiry first
-- Must DROP first because CREATE OR REPLACE cannot change return type
-- ============================================================

DROP FUNCTION IF EXISTS public.register_for_event(UUID, UUID);

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
-- 40d. create_recurring_event_instances
-- Generates future event instances from a parent event on a
-- weekly cadence. Each instance is independent but linked via
-- parent_event_id.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_recurring_event_instances(
  p_event_id UUID,
  p_day_of_week INTEGER,        -- ISO weekday: 1=Mon ... 7=Sun
  p_end_date DATE DEFAULT NULL,
  p_occurrences INTEGER DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_parent RECORD;
  v_bay_ids UUID[];
  v_current_date DATE;
  v_count INTEGER := 0;
  v_max INTEGER;
  v_new_start TIMESTAMPTZ;
  v_new_end TIMESTAMPTZ;
  v_time_diff INTERVAL;
  v_new_event_id UUID;
BEGIN
  -- Get parent event
  SELECT * INTO v_parent
  FROM public.events WHERE id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  -- Get bay assignments
  SELECT ARRAY_AGG(bay_id) INTO v_bay_ids
  FROM public.event_bays WHERE event_id = p_event_id;

  -- Calculate duration
  v_time_diff := v_parent.end_time - v_parent.start_time;

  -- Set the recurrence rule on the parent
  UPDATE public.events
  SET recurrence_rule = jsonb_build_object(
    'day_of_week', p_day_of_week,
    'end_date', p_end_date,
    'occurrences', p_occurrences
  )
  WHERE id = p_event_id;

  -- Determine max occurrences
  IF p_occurrences IS NOT NULL THEN
    v_max := p_occurrences;
  ELSE
    v_max := 52; -- safety cap: 1 year of weekly events
  END IF;

  -- Start from next week (skip the parent event's date)
  v_current_date := (v_parent.start_time::date) + 7;

  WHILE v_count < v_max LOOP
    -- Check end date
    IF p_end_date IS NOT NULL AND v_current_date > p_end_date THEN
      EXIT;
    END IF;

    -- Check day of week matches (ISO: 1=Mon ... 7=Sun)
    IF EXTRACT(ISODOW FROM v_current_date) = p_day_of_week THEN
      -- Build new timestamps preserving time-of-day
      v_new_start := v_current_date + (v_parent.start_time::time)::interval;
      v_new_end := v_new_start + v_time_diff;

      -- Create the instance
      INSERT INTO public.events (
        org_id, location_id, name, description, start_time, end_time,
        capacity, price_cents, members_only, member_enrollment_days_before,
        guest_enrollment_days_before, waitlist_promotion_hours, status,
        parent_event_id, created_by
      ) VALUES (
        v_parent.org_id, v_parent.location_id, v_parent.name, v_parent.description,
        v_new_start, v_new_end, v_parent.capacity, v_parent.price_cents,
        v_parent.members_only, v_parent.member_enrollment_days_before,
        v_parent.guest_enrollment_days_before, v_parent.waitlist_promotion_hours,
        'draft', p_event_id, v_parent.created_by
      ) RETURNING id INTO v_new_event_id;

      -- Copy bay assignments
      IF v_bay_ids IS NOT NULL THEN
        INSERT INTO public.event_bays (event_id, bay_id)
        SELECT v_new_event_id, unnest(v_bay_ids);
      END IF;

      v_count := v_count + 1;
    END IF;

    v_current_date := v_current_date + 1;
  END LOOP;

  RETURN json_build_object(
    'parent_event_id', p_event_id,
    'instances_created', v_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 40e. update_future_event_instances
-- "Edit this and all future" — updates specified fields on all
-- future instances of a recurring event.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_future_event_instances(
  p_parent_event_id UUID,
  p_from_date DATE,
  p_changes JSONB
)
RETURNS JSON AS $$
DECLARE
  v_updated INTEGER := 0;
  v_field TEXT;
  v_value JSONB;
  v_set_clauses TEXT[] := '{}';
BEGIN
  -- Build dynamic SET clauses from the changes JSONB
  -- Only allow safe fields to be updated
  FOR v_field, v_value IN SELECT * FROM jsonb_each(p_changes)
  LOOP
    IF v_field = ANY(ARRAY[
      'name', 'description', 'capacity', 'price_cents', 'members_only',
      'member_enrollment_days_before', 'guest_enrollment_days_before',
      'waitlist_promotion_hours'
    ]) THEN
      v_set_clauses := array_append(v_set_clauses,
        format('%I = %L', v_field, v_value #>> '{}')
      );
    END IF;
  END LOOP;

  IF array_length(v_set_clauses, 1) IS NULL OR array_length(v_set_clauses, 1) = 0 THEN
    RETURN json_build_object('updated', 0);
  END IF;

  -- Update future instances (draft only — published events are untouched)
  EXECUTE format(
    'UPDATE public.events SET %s, updated_at = NOW() WHERE parent_event_id = %L AND start_time::date >= %L AND status = %L',
    array_to_string(v_set_clauses, ', '),
    p_parent_event_id,
    p_from_date,
    'draft'
  );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN json_build_object('updated', v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
