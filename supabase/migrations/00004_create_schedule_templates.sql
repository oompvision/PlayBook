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
