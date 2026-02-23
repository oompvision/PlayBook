-- ============================================================
-- Prevent double-booking at the database level.
--
-- This trigger fires BEFORE INSERT on booking_slots and rejects
-- the insert if the referenced bay_schedule_slot is not
-- 'available'. This acts as a final safety net beyond the
-- SELECT ... FOR UPDATE check in create_booking().
-- ============================================================

create or replace function public.prevent_double_booking()
returns trigger as $$
declare
  v_status text;
begin
  select status into v_status
  from public.bay_schedule_slots
  where id = new.bay_schedule_slot_id
  for update;

  if v_status is null then
    raise exception 'Slot % does not exist', new.bay_schedule_slot_id;
  end if;

  if v_status != 'available' then
    raise exception 'Slot % is not available (status: %)', new.bay_schedule_slot_id, v_status;
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger trg_prevent_double_booking
  before insert on public.booking_slots
  for each row
  execute function public.prevent_double_booking();
