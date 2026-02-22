-- ============================================================
-- Fix cancel_booking: delete booking_slots rows so the
-- unique constraint on bay_schedule_slot_id doesn't block
-- rebooking a cancelled slot.
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

  -- Remove the junction rows so the slot can be linked to a new booking
  delete from public.booking_slots
  where booking_id = p_booking_id;

  -- Mark booking as cancelled
  update public.bookings
  set status = 'cancelled', updated_at = now()
  where id = p_booking_id;
end;
$$ language plpgsql security definer;
