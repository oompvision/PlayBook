-- ============================================================
-- Atomic booking function with row-level locking
-- Prevents double-bookings using SELECT ... FOR UPDATE
-- ============================================================

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
  v_total_price integer := 0;
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_confirmation_code text;
  v_booking_id uuid;
  v_locked_slots uuid[];
begin
  -- Lock the requested slots with FOR UPDATE to prevent concurrent bookings
  for v_slot in
    select id, start_time, end_time, price_cents, status
    from public.bay_schedule_slots
    where id = any(p_slot_ids)
    order by start_time
    for update
  loop
    -- Check each slot is still available
    if v_slot.status != 'available' then
      raise exception 'Slot % is no longer available (status: %)', v_slot.id, v_slot.status;
    end if;

    v_total_price := v_total_price + v_slot.price_cents;

    if v_start_time is null or v_slot.start_time < v_start_time then
      v_start_time := v_slot.start_time;
    end if;

    if v_end_time is null or v_slot.end_time > v_end_time then
      v_end_time := v_slot.end_time;
    end if;

    v_locked_slots := array_append(v_locked_slots, v_slot.id);
  end loop;

  -- Verify we found all requested slots
  if array_length(v_locked_slots, 1) != array_length(p_slot_ids, 1) then
    raise exception 'Some requested slots were not found';
  end if;

  -- Generate unique confirmation code
  loop
    v_confirmation_code := public.generate_confirmation_code();
    exit when not exists (
      select 1 from public.bookings where confirmation_code = v_confirmation_code
    );
  end loop;

  -- Create the booking
  insert into public.bookings (
    org_id, customer_id, bay_id, date,
    start_time, end_time, total_price_cents,
    status, confirmation_code, notes
  ) values (
    p_org_id, p_customer_id, p_bay_id, p_date,
    v_start_time, v_end_time, v_total_price,
    'confirmed', v_confirmation_code, p_notes
  ) returning id into v_booking_id;

  -- Link slots to the booking
  insert into public.booking_slots (booking_id, bay_schedule_slot_id)
  select v_booking_id, unnest(p_slot_ids);

  -- Mark slots as booked
  update public.bay_schedule_slots
  set status = 'booked', updated_at = now()
  where id = any(p_slot_ids);

  return json_build_object(
    'booking_id', v_booking_id,
    'confirmation_code', v_confirmation_code,
    'total_price_cents', v_total_price,
    'start_time', v_start_time,
    'end_time', v_end_time
  );
end;
$$ language plpgsql security definer;

-- ============================================================
-- Cancel booking function — reverts slots to available
-- ============================================================

create or replace function public.cancel_booking(
  p_booking_id uuid
)
returns void as $$
begin
  -- Revert associated slots to available
  update public.bay_schedule_slots
  set status = 'available', updated_at = now()
  where id in (
    select bay_schedule_slot_id from public.booking_slots
    where booking_id = p_booking_id
  );

  -- Mark booking as cancelled
  update public.bookings
  set status = 'cancelled', updated_at = now()
  where id = p_booking_id;
end;
$$ language plpgsql security definer;
