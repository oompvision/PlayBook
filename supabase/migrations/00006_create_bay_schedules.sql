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
