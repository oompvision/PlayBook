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

-- ============================================================
-- RLS Policies for organizations
-- ============================================================

alter table public.organizations enable row level security;

-- Anyone can read org info (needed for subdomain resolution)
create policy "organizations_public_read"
  on public.organizations for select
  using (true);

-- Super admins can insert new orgs
create policy "organizations_super_admin_insert"
  on public.organizations for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- Super admins can update any org
create policy "organizations_super_admin_update"
  on public.organizations for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );
