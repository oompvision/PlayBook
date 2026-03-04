-- ============================================================
-- Enforce bookable_window_days in create_booking and
-- create_guest_booking functions for slot-based scheduling.
-- Previously only dynamic scheduling enforced the window.
-- ============================================================

-- Update create_booking to check bookable window
create or replace function public.create_booking(
  p_org_id uuid,
  p_customer_id uuid,
  p_bay_id uuid,
  p_date date,
  p_slot_ids uuid[],
  p_notes text default null
)
returns json as $$
declare
  v_slot record;
  v_locked_slots uuid[];
  v_group_start timestamptz;
  v_group_end timestamptz;
  v_group_price integer;
  v_group_slot_ids uuid[];
  v_confirmation_code text;
  v_booking_id uuid;
  v_results json[] := '{}';
  v_org record;
  v_today date;
  v_max_date date;
begin
  -- Look up org settings for bookable window
  select timezone, bookable_window_days
  into v_org
  from public.organizations
  where id = p_org_id;

  -- Compute today in org timezone
  v_today := (now() at time zone coalesce(v_org.timezone, 'America/New_York'))::date;
  v_max_date := v_today + coalesce(v_org.bookable_window_days, 30);

  -- Validate date is within bookable window
  if p_date < v_today then
    raise exception 'Cannot book in the past';
  end if;
  if p_date > v_max_date then
    raise exception 'Cannot book more than % days in advance', coalesce(v_org.bookable_window_days, 30);
  end if;

  -- Lock the requested slots with FOR UPDATE to prevent concurrent bookings
  -- and collect them into an array ordered by start_time
  v_locked_slots := '{}';
  for v_slot in
    select id, start_time, end_time, price_cents, status
    from public.bay_schedule_slots
    where id = any(p_slot_ids)
    order by start_time
    for update
  loop
    if v_slot.status != 'available' then
      raise exception 'Slot % is no longer available (status: %)', v_slot.id, v_slot.status;
    end if;
    v_locked_slots := array_append(v_locked_slots, v_slot.id);
  end loop;

  -- Verify we found all requested slots
  if array_length(v_locked_slots, 1) is distinct from array_length(p_slot_ids, 1) then
    raise exception 'Some requested slots were not found';
  end if;

  -- Now iterate ordered slots, grouping consecutive ones
  v_group_start := null;
  v_group_end := null;
  v_group_price := 0;
  v_group_slot_ids := '{}';

  for v_slot in
    select id, start_time, end_time, price_cents
    from public.bay_schedule_slots
    where id = any(p_slot_ids)
    order by start_time
  loop
    -- If this slot is not consecutive with the current group, flush the group
    if v_group_end is not null and v_slot.start_time > v_group_end then
      -- Generate unique confirmation code
      loop
        v_confirmation_code := public.generate_confirmation_code();
        exit when not exists (
          select 1 from public.bookings where confirmation_code = v_confirmation_code
        );
      end loop;

      -- Create booking for current group
      insert into public.bookings (
        org_id, customer_id, bay_id, date,
        start_time, end_time, total_price_cents,
        status, confirmation_code, notes
      ) values (
        p_org_id, p_customer_id, p_bay_id, p_date,
        v_group_start, v_group_end, v_group_price,
        'confirmed', v_confirmation_code, p_notes
      ) returning id into v_booking_id;

      insert into public.booking_slots (booking_id, bay_schedule_slot_id)
      select v_booking_id, unnest(v_group_slot_ids);

      update public.bay_schedule_slots
      set status = 'booked', updated_at = now()
      where id = any(v_group_slot_ids);

      v_results := array_append(v_results, json_build_object(
        'booking_id', v_booking_id,
        'confirmation_code', v_confirmation_code,
        'total_price_cents', v_group_price,
        'start_time', v_group_start,
        'end_time', v_group_end
      ));

      -- Reset group
      v_group_start := null;
      v_group_end := null;
      v_group_price := 0;
      v_group_slot_ids := '{}';
    end if;

    -- Add slot to current group
    if v_group_start is null then
      v_group_start := v_slot.start_time;
    end if;
    v_group_end := v_slot.end_time;
    v_group_price := v_group_price + v_slot.price_cents;
    v_group_slot_ids := array_append(v_group_slot_ids, v_slot.id);
  end loop;

  -- Flush the last group
  if v_group_start is not null then
    loop
      v_confirmation_code := public.generate_confirmation_code();
      exit when not exists (
        select 1 from public.bookings where confirmation_code = v_confirmation_code
      );
    end loop;

    insert into public.bookings (
      org_id, customer_id, bay_id, date,
      start_time, end_time, total_price_cents,
      status, confirmation_code, notes
    ) values (
      p_org_id, p_customer_id, p_bay_id, p_date,
      v_group_start, v_group_end, v_group_price,
      'confirmed', v_confirmation_code, p_notes
    ) returning id into v_booking_id;

    insert into public.booking_slots (booking_id, bay_schedule_slot_id)
    select v_booking_id, unnest(v_group_slot_ids);

    update public.bay_schedule_slots
    set status = 'booked', updated_at = now()
    where id = any(v_group_slot_ids);

    v_results := array_append(v_results, json_build_object(
      'booking_id', v_booking_id,
      'confirmation_code', v_confirmation_code,
      'total_price_cents', v_group_price,
      'start_time', v_group_start,
      'end_time', v_group_end
    ));
  end if;

  -- Return results: single object for backwards compat when 1 group,
  -- or array when multiple groups
  if array_length(v_results, 1) = 1 then
    return v_results[1];
  else
    return array_to_json(v_results);
  end if;
end;
$$ language plpgsql security definer;
