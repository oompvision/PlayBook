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

-- ============================================================
-- RLS Policies for schedule_templates
-- ============================================================

alter table public.schedule_templates enable row level security;

-- Admins can read templates in their org
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

-- Admins can insert templates in their org
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

-- Admins can update templates in their org
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

-- Admins can delete templates in their org
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

-- Super admins: full access
create policy "schedule_templates_super_admin_all"
  on public.schedule_templates for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );
