-- ===========================================================
-- FILE: 00001_create_organizations.sql
-- ===========================================================

-- ============================================================
-- 1. organizations
-- Represents a sports facility (golf sim center, tennis club, etc.)
-- ============================================================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'America/New_York',
  default_slot_duration_minutes integer not null default 60,
  logo_url text,
  description text,
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for subdomain lookup
create index if not exists idx_organizations_slug on public.organizations (slug);

-- Auto-update updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_organizations_updated_at
  before update on public.organizations
  for each row execute function public.handle_updated_at();

-- Enable RLS (policies added in 00011 after all tables exist)
alter table public.organizations enable row level security;

-- Public read doesn't reference profiles, so it's safe here
create policy "organizations_public_read"
  on public.organizations for select
  using (true);


-- ===========================================================
-- FILE: 00002_create_profiles.sql
-- ===========================================================

-- ============================================================
-- 2. profiles
-- Extended user profile linked to Supabase Auth.
-- Super admins have null org_id.
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete set null,
  email text not null,
  full_name text,
  phone text,
  role text not null default 'customer' check (role in ('super_admin', 'admin', 'customer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_profiles_org_id on public.profiles (org_id);
create index if not exists idx_profiles_role on public.profiles (role);
create index if not exists idx_profiles_email on public.profiles (email);

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- ============================================================
-- Auto-create profile on signup
-- ============================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Enable RLS (policies added in 00011 after all tables exist)
alter table public.profiles enable row level security;

-- Self-referencing policies are safe here (no cross-table dependency)
create policy "profiles_self_read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_self_update"
  on public.profiles for update
  using (auth.uid() = id);


-- ===========================================================
-- FILE: 00003_create_bays.sql
-- ===========================================================

-- ============================================================
-- 3. bays
-- Individual bookable resources within a facility.
-- ============================================================

create table if not exists public.bays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  resource_type text,
  equipment_info text,
  hourly_rate_cents integer not null default 0,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_bays_org_id on public.bays (org_id);
create index if not exists idx_bays_org_active on public.bays (org_id, is_active);

create trigger set_bays_updated_at
  before update on public.bays
  for each row execute function public.handle_updated_at();

-- Enable RLS (role-based policies added in 00011)
alter table public.bays enable row level security;

-- Public can read active bays (no profiles dependency)
create policy "bays_public_read_active"
  on public.bays for select
  using (is_active = true);


-- ===========================================================
-- FILE: 00004_create_schedule_templates.sql
-- ===========================================================

-- ============================================================
-- 4. schedule_templates
-- Reusable daily schedule templates that admins create.
-- ============================================================

create table if not exists public.schedule_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_schedule_templates_org_id on public.schedule_templates (org_id);

create trigger set_schedule_templates_updated_at
  before update on public.schedule_templates
  for each row execute function public.handle_updated_at();

-- Enable RLS (role-based policies added in 00011)
alter table public.schedule_templates enable row level security;


-- ===========================================================
-- FILE: 00005_create_template_slots.sql
-- ===========================================================

-- ============================================================
-- 5. template_slots
-- Time slot definitions within a template (abstract, not date-bound).
-- ============================================================

create table if not exists public.template_slots (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.schedule_templates(id) on delete cascade,
  start_time time not null,
  end_time time not null,
  price_cents integer,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_template_slots_template_id on public.template_slots (template_id);

-- Constraint: end_time must be after start_time
alter table public.template_slots
  add constraint template_slots_time_order check (end_time > start_time);

-- Enable RLS (role-based policies added in 00011)
alter table public.template_slots enable row level security;


-- ===========================================================
-- FILE: 00006_create_bay_schedules.sql
-- ===========================================================

-- ============================================================
-- 6. bay_schedules
-- Concrete daily schedule for a specific bay on a specific date.
-- ============================================================

create table if not exists public.bay_schedules (
  id uuid primary key default gen_random_uuid(),
  bay_id uuid not null references public.bays(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  date date not null,
  template_id uuid references public.schedule_templates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_bay_schedules_bay_id on public.bay_schedules (bay_id);
create index if not exists idx_bay_schedules_org_id on public.bay_schedules (org_id);
create index if not exists idx_bay_schedules_date on public.bay_schedules (date);
create index if not exists idx_bay_schedules_bay_date on public.bay_schedules (bay_id, date);

-- Unique constraint: one schedule per bay per date
alter table public.bay_schedules
  add constraint bay_schedules_bay_date_unique unique (bay_id, date);

create trigger set_bay_schedules_updated_at
  before update on public.bay_schedules
  for each row execute function public.handle_updated_at();

-- Enable RLS (role-based policies added in 00011)
alter table public.bay_schedules enable row level security;

-- Public can read schedules (no profiles dependency)
create policy "bay_schedules_public_read"
  on public.bay_schedules for select
  using (true);


-- ===========================================================
-- FILE: 00007_create_bay_schedule_slots.sql
-- ===========================================================

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

-- Enable RLS (role-based policies added in 00011)
alter table public.bay_schedule_slots enable row level security;

-- Public can read slots (no profiles dependency)
create policy "bay_schedule_slots_public_read"
  on public.bay_schedule_slots for select
  using (true);


-- ===========================================================
-- FILE: 00008_create_bookings.sql
-- ===========================================================

-- ============================================================
-- 8. bookings
-- A customer's reservation. Can span multiple consecutive slots.
-- ============================================================

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  bay_id uuid not null references public.bays(id) on delete cascade,
  date date not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  total_price_cents integer not null default 0,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  confirmation_code text not null unique,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_bookings_org_id on public.bookings (org_id);
create index if not exists idx_bookings_customer_id on public.bookings (customer_id);
create index if not exists idx_bookings_bay_id on public.bookings (bay_id);
create index if not exists idx_bookings_date on public.bookings (date);
create index if not exists idx_bookings_status on public.bookings (status);
create index if not exists idx_bookings_confirmation_code on public.bookings (confirmation_code);

create trigger set_bookings_updated_at
  before update on public.bookings
  for each row execute function public.handle_updated_at();

-- ============================================================
-- Confirmation code generation function
-- Format: PB-XXXXXX (alphanumeric)
-- ============================================================

create or replace function public.generate_confirmation_code()
returns text as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := 'PB-';
  i integer;
begin
  for i in 1..6 loop
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  end loop;
  return result;
end;
$$ language plpgsql;

-- Enable RLS (role-based policies added in 00011)
alter table public.bookings enable row level security;

-- Customer self-referencing policies (no cross-table profiles lookup)
create policy "bookings_customer_read_own"
  on public.bookings for select
  using (auth.uid() = customer_id);

create policy "bookings_customer_insert"
  on public.bookings for insert
  with check (auth.uid() = customer_id);


-- ===========================================================
-- FILE: 00009_create_booking_slots.sql
-- ===========================================================

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


-- ===========================================================
-- FILE: 00010_create_booking_function.sql
-- ===========================================================

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


-- ===========================================================
-- FILE: 00011_create_rls_policies.sql
-- ===========================================================

-- ============================================================
-- 11. RLS Policies (role-based)
-- All policies that reference public.profiles for role checks.
-- Must run AFTER all tables are created (00001-00009).
-- ============================================================

-- ============================================================
-- organizations policies
-- ============================================================

create policy "organizations_super_admin_insert"
  on public.organizations for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

create policy "organizations_super_admin_update"
  on public.organizations for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- ============================================================
-- profiles policies (admin/super_admin cross-row access)
-- ============================================================

create policy "profiles_admin_org_read"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles as p
      where p.id = auth.uid()
      and p.role = 'admin'
      and p.org_id = profiles.org_id
    )
  );

create policy "profiles_super_admin_read"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles as p
      where p.id = auth.uid()
      and p.role = 'super_admin'
    )
  );

create policy "profiles_super_admin_insert"
  on public.profiles for insert
  with check (
    exists (
      select 1 from public.profiles as p
      where p.id = auth.uid()
      and p.role = 'super_admin'
    )
  );

create policy "profiles_super_admin_update"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles as p
      where p.id = auth.uid()
      and p.role = 'super_admin'
    )
  );

-- ============================================================
-- bays policies
-- ============================================================

create policy "bays_admin_read"
  on public.bays for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bays.org_id
    )
  );

create policy "bays_admin_insert"
  on public.bays for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bays.org_id
    )
  );

create policy "bays_admin_update"
  on public.bays for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bays.org_id
    )
  );

create policy "bays_super_admin_all"
  on public.bays for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- ============================================================
-- schedule_templates policies
-- ============================================================

create policy "schedule_templates_admin_read"
  on public.schedule_templates for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = schedule_templates.org_id
    )
  );

create policy "schedule_templates_admin_insert"
  on public.schedule_templates for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = schedule_templates.org_id
    )
  );

create policy "schedule_templates_admin_update"
  on public.schedule_templates for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = schedule_templates.org_id
    )
  );

create policy "schedule_templates_admin_delete"
  on public.schedule_templates for delete
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = schedule_templates.org_id
    )
  );

create policy "schedule_templates_super_admin_all"
  on public.schedule_templates for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- ============================================================
-- template_slots policies
-- ============================================================

create policy "template_slots_admin_read"
  on public.template_slots for select
  using (
    exists (
      select 1 from public.schedule_templates st
      join public.profiles p on p.org_id = st.org_id
      where st.id = template_slots.template_id
      and p.id = auth.uid()
      and p.role = 'admin'
    )
  );

create policy "template_slots_admin_insert"
  on public.template_slots for insert
  with check (
    exists (
      select 1 from public.schedule_templates st
      join public.profiles p on p.org_id = st.org_id
      where st.id = template_slots.template_id
      and p.id = auth.uid()
      and p.role = 'admin'
    )
  );

create policy "template_slots_admin_update"
  on public.template_slots for update
  using (
    exists (
      select 1 from public.schedule_templates st
      join public.profiles p on p.org_id = st.org_id
      where st.id = template_slots.template_id
      and p.id = auth.uid()
      and p.role = 'admin'
    )
  );

create policy "template_slots_admin_delete"
  on public.template_slots for delete
  using (
    exists (
      select 1 from public.schedule_templates st
      join public.profiles p on p.org_id = st.org_id
      where st.id = template_slots.template_id
      and p.id = auth.uid()
      and p.role = 'admin'
    )
  );

create policy "template_slots_super_admin_all"
  on public.template_slots for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- ============================================================
-- bay_schedules policies
-- ============================================================

create policy "bay_schedules_admin_insert"
  on public.bay_schedules for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bay_schedules.org_id
    )
  );

create policy "bay_schedules_admin_update"
  on public.bay_schedules for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bay_schedules.org_id
    )
  );

create policy "bay_schedules_admin_delete"
  on public.bay_schedules for delete
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bay_schedules.org_id
    )
  );

create policy "bay_schedules_super_admin_all"
  on public.bay_schedules for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- ============================================================
-- bay_schedule_slots policies
-- ============================================================

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

create policy "bay_schedule_slots_super_admin_all"
  on public.bay_schedule_slots for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- ============================================================
-- bookings policies (admin/super_admin)
-- ============================================================

create policy "bookings_admin_read"
  on public.bookings for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bookings.org_id
    )
  );

create policy "bookings_admin_insert"
  on public.bookings for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bookings.org_id
    )
  );

create policy "bookings_admin_update"
  on public.bookings for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bookings.org_id
    )
  );

create policy "bookings_super_admin_all"
  on public.bookings for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- ============================================================
-- booking_slots policies (admin/super_admin)
-- ============================================================

create policy "booking_slots_admin_read"
  on public.booking_slots for select
  using (
    exists (
      select 1 from public.bookings b
      join public.profiles p on p.org_id = b.org_id
      where b.id = booking_slots.booking_id
      and p.id = auth.uid()
      and p.role = 'admin'
    )
  );

create policy "booking_slots_super_admin_all"
  on public.booking_slots for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );



-- ===========================================================
-- SEED DATA
-- ===========================================================

-- ============================================================
-- Seed data for PlayBook
-- Run this AFTER migrations and AFTER creating the super admin
-- user in Supabase Auth (anthony@sidelineswap.com)
-- ============================================================

-- NOTE: The super admin profile will be auto-created by the
-- handle_new_user trigger when the auth user is created.
-- You need to manually update the role to 'super_admin'
-- and set org_id to null:
--
--   UPDATE public.profiles
--   SET role = 'super_admin', org_id = null
--   WHERE email = 'anthony@sidelineswap.com';

-- ============================================================
-- Demo organizations
-- ============================================================

insert into public.organizations (id, name, slug, timezone, default_slot_duration_minutes, description, address)
values
  (
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'Justin Koff Golf Sim',
    'justin-koff-golf-sim',
    'America/New_York',
    60,
    'Premium indoor golf simulator experience with TrackMan technology. Perfect your swing year-round.',
    '123 Fairway Drive, Boston, MA 02101'
  ),
  (
    'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    'Coffee & Tee',
    'coffee-and-tee',
    'America/New_York',
    60,
    'Where coffee meets golf. Enjoy a latte while crushing drives on our state-of-the-art simulators.',
    '456 Links Avenue, Cambridge, MA 02139'
  )
on conflict (slug) do nothing;

-- ============================================================
-- Demo bays for Justin Koff Golf Sim
-- ============================================================

insert into public.bays (org_id, name, description, resource_type, equipment_info, hourly_rate_cents, sort_order, is_active)
values
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Bay 1', 'Private simulator bay with lounge seating', 'Golf Simulator', 'TrackMan iO', 6000, 1, true),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Bay 2', 'Private simulator bay with lounge seating', 'Golf Simulator', 'TrackMan iO', 6000, 2, true),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Bay 3', 'Premium bay with extra space for groups', 'Golf Simulator', 'TrackMan iO Launch Monitor', 7500, 3, true),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'The Tour Suite', 'Our flagship bay with tour-level setup', 'Golf Simulator', 'Full Swing Kit', 10000, 4, true)
on conflict do nothing;

-- ============================================================
-- Demo bays for Coffee & Tee
-- ============================================================

insert into public.bays (org_id, name, description, resource_type, equipment_info, hourly_rate_cents, sort_order, is_active)
values
  ('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'Espresso Bay', 'Cozy bay next to the coffee bar', 'Golf Simulator', 'SkyTrak+', 4500, 1, true),
  ('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'Latte Lounge', 'Open-concept bay with comfortable seating', 'Golf Simulator', 'SkyTrak+', 4500, 2, true),
  ('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'The Roast Room', 'Private room for groups and events', 'Golf Simulator', 'Uneekor QED', 6000, 3, true)
on conflict do nothing;
