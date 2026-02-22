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

-- ============================================================
-- RLS Policies for profiles
-- ============================================================

alter table public.profiles enable row level security;

-- Users can read their own profile
create policy "profiles_self_read"
  on public.profiles for select
  using (auth.uid() = id);

-- Users can update their own profile (name, phone only — role/org_id protected by app logic)
create policy "profiles_self_update"
  on public.profiles for update
  using (auth.uid() = id);

-- Admins can read all profiles in their org
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

-- Super admins can read all profiles
create policy "profiles_super_admin_read"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles as p
      where p.id = auth.uid()
      and p.role = 'super_admin'
    )
  );

-- Super admins can insert profiles (for admin provisioning)
create policy "profiles_super_admin_insert"
  on public.profiles for insert
  with check (
    exists (
      select 1 from public.profiles as p
      where p.id = auth.uid()
      and p.role = 'super_admin'
    )
  );

-- Super admins can update any profile
create policy "profiles_super_admin_update"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles as p
      where p.id = auth.uid()
      and p.role = 'super_admin'
    )
  );
