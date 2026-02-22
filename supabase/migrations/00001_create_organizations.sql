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
