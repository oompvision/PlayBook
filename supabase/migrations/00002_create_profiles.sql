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
