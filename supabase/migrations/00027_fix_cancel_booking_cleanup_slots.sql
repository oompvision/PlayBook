-- ============================================================
-- Fix cancel_booking: delete booking_slots junction rows so the
-- unique constraint on bay_schedule_slot_id doesn't block
-- rebooking a previously-cancelled slot.
--
-- Also cleans up existing orphaned booking_slots rows from
-- already-cancelled bookings that were created before this fix.
-- ============================================================

-- 1. Update the cancel_booking function to delete junction rows
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

  -- Remove the junction rows so the slot can be linked to a new booking
  delete from public.booking_slots
  where booking_id = p_booking_id;

  -- Mark booking as cancelled
  update public.bookings
  set status = 'cancelled', updated_at = now()
  where id = p_booking_id;
end;
$$ language plpgsql security definer;

-- 2. Clean up orphaned booking_slots rows from previously cancelled bookings
delete from public.booking_slots
where booking_id in (
  select id from public.bookings where status = 'cancelled'
);
