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
