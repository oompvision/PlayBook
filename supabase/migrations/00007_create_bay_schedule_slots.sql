-- ============================================================
-- 7. bay_schedule_slots
-- Individual bookable time slots for a bay on a specific date.
-- ============================================================

create table if not exists public.bay_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  bay_schedule_id uuid not null references public.bay_schedules(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  price_cents integer not null default 0,
  status text not null default 'available' check (status in ('available', 'booked', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_bay_schedule_slots_schedule_id on public.bay_schedule_slots (bay_schedule_id);
create index if not exists idx_bay_schedule_slots_org_id on public.bay_schedule_slots (org_id);
create index if not exists idx_bay_schedule_slots_status on public.bay_schedule_slots (status);
create index if not exists idx_bay_schedule_slots_time on public.bay_schedule_slots (start_time, end_time);

-- Constraint: end_time must be after start_time
alter table public.bay_schedule_slots
  add constraint bay_schedule_slots_time_order check (end_time > start_time);

create trigger set_bay_schedule_slots_updated_at
  before update on public.bay_schedule_slots
  for each row execute function public.handle_updated_at();

-- ============================================================
-- RLS Policies for bay_schedule_slots
-- ============================================================

alter table public.bay_schedule_slots enable row level security;

-- Public can read slots (needed for availability calendar)
create policy "bay_schedule_slots_public_read"
  on public.bay_schedule_slots for select
  using (true);

-- Admins can insert slots in their org
create policy "bay_schedule_slots_admin_insert"
  on public.bay_schedule_slots for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bay_schedule_slots.org_id
    )
  );

-- Admins can update slots in their org
create policy "bay_schedule_slots_admin_update"
  on public.bay_schedule_slots for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bay_schedule_slots.org_id
    )
  );

-- Admins can delete slots in their org
create policy "bay_schedule_slots_admin_delete"
  on public.bay_schedule_slots for delete
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bay_schedule_slots.org_id
    )
  );

-- Super admins: full access
create policy "bay_schedule_slots_super_admin_all"
  on public.bay_schedule_slots for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );
