-- ============================================================
-- 5. template_slots
-- Time slot definitions within a template (abstract, not date-bound).
-- ============================================================

create table if not exists public.template_slots (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.schedule_templates(id) on delete cascade,
  start_time time not null,
  end_time time not null,
  price_cents integer,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_template_slots_template_id on public.template_slots (template_id);

-- Constraint: end_time must be after start_time
alter table public.template_slots
  add constraint template_slots_time_order check (end_time > start_time);

-- Enable RLS (role-based policies added in 00011)
alter table public.template_slots enable row level security;
