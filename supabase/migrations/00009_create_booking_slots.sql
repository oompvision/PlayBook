-- ============================================================
-- 9. booking_slots
-- Junction table linking a booking to the specific slots it occupies.
-- ============================================================

create table if not exists public.booking_slots (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  bay_schedule_slot_id uuid not null references public.bay_schedule_slots(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_booking_slots_booking_id on public.booking_slots (booking_id);
create index if not exists idx_booking_slots_slot_id on public.booking_slots (bay_schedule_slot_id);

-- Unique constraint: a slot can only be in one booking
alter table public.booking_slots
  add constraint booking_slots_slot_unique unique (bay_schedule_slot_id);

-- Enable RLS (role-based policies added in 00011)
alter table public.booking_slots enable row level security;

-- Customer self-referencing policies (looks up bookings, not profiles)
create policy "booking_slots_customer_read"
  on public.booking_slots for select
  using (
    exists (
      select 1 from public.bookings
      where bookings.id = booking_slots.booking_id
      and bookings.customer_id = auth.uid()
    )
  );

create policy "booking_slots_customer_insert"
  on public.booking_slots for insert
  with check (
    exists (
      select 1 from public.bookings
      where bookings.id = booking_slots.booking_id
      and bookings.customer_id = auth.uid()
    )
  );
