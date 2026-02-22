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

-- ============================================================
-- RLS Policies for bays
-- ============================================================

alter table public.bays enable row level security;

-- Public can read active bays
create policy "bays_public_read_active"
  on public.bays for select
  using (is_active = true);

-- Admins can read all bays in their org (including inactive)
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

-- Admins can insert bays in their org
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

-- Admins can update bays in their org
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

-- Super admins: full access
create policy "bays_super_admin_all"
  on public.bays for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );
