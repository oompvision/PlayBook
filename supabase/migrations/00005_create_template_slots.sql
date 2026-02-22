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

-- ============================================================
-- RLS Policies for template_slots
-- Inherit access from the parent schedule_template
-- ============================================================

alter table public.template_slots enable row level security;

-- Admins can read template slots for templates in their org
create policy "template_slots_admin_read"
  on public.template_slots for select
  using (
    exists (
      select 1 from public.schedule_templates st
      join public.profiles p on p.org_id = st.org_id
      where st.id = template_slots.template_id
      and p.id = auth.uid()
      and p.role = 'admin'
    )
  );

-- Admins can insert template slots
create policy "template_slots_admin_insert"
  on public.template_slots for insert
  with check (
    exists (
      select 1 from public.schedule_templates st
      join public.profiles p on p.org_id = st.org_id
      where st.id = template_slots.template_id
      and p.id = auth.uid()
      and p.role = 'admin'
    )
  );

-- Admins can update template slots
create policy "template_slots_admin_update"
  on public.template_slots for update
  using (
    exists (
      select 1 from public.schedule_templates st
      join public.profiles p on p.org_id = st.org_id
      where st.id = template_slots.template_id
      and p.id = auth.uid()
      and p.role = 'admin'
    )
  );

-- Admins can delete template slots
create policy "template_slots_admin_delete"
  on public.template_slots for delete
  using (
    exists (
      select 1 from public.schedule_templates st
      join public.profiles p on p.org_id = st.org_id
      where st.id = template_slots.template_id
      and p.id = auth.uid()
      and p.role = 'admin'
    )
  );

-- Super admins: full access
create policy "template_slots_super_admin_all"
  on public.template_slots for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );
