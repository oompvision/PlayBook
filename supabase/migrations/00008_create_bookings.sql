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

-- ============================================================
-- RLS Policies for bookings
-- ============================================================

alter table public.bookings enable row level security;

-- Customers can read their own bookings
create policy "bookings_customer_read_own"
  on public.bookings for select
  using (auth.uid() = customer_id);

-- Customers can insert bookings (for themselves)
create policy "bookings_customer_insert"
  on public.bookings for insert
  with check (auth.uid() = customer_id);

-- Admins can read all bookings in their org
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

-- Admins can insert bookings in their org (walk-in bookings)
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

-- Admins can update bookings in their org (cancel, etc.)
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

-- Super admins: full access
create policy "bookings_super_admin_all"
  on public.bookings for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );
