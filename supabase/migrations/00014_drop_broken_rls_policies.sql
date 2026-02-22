-- ============================================================
-- Drop old RLS policies that cause infinite recursion
--
-- The policies from migration 00011 reference profiles inside
-- USING/WITH CHECK clauses. When profiles has RLS enabled, this
-- triggers the profiles policies which also reference profiles,
-- causing "infinite recursion detected in policy for relation
-- profiles". The _v2 policies from migration 00013 use
-- is_super_admin() SECURITY DEFINER to avoid this.
-- ============================================================

-- profiles (self-referential → infinite recursion)
drop policy if exists "profiles_admin_org_read" on public.profiles;
drop policy if exists "profiles_super_admin_read" on public.profiles;
drop policy if exists "profiles_super_admin_insert" on public.profiles;
drop policy if exists "profiles_super_admin_update" on public.profiles;

-- organizations
drop policy if exists "organizations_super_admin_insert" on public.organizations;
drop policy if exists "organizations_super_admin_update" on public.organizations;

-- bays
drop policy if exists "bays_admin_read" on public.bays;
drop policy if exists "bays_admin_insert" on public.bays;
drop policy if exists "bays_admin_update" on public.bays;
drop policy if exists "bays_super_admin_all" on public.bays;

-- schedule_templates
drop policy if exists "schedule_templates_admin_read" on public.schedule_templates;
drop policy if exists "schedule_templates_admin_insert" on public.schedule_templates;
drop policy if exists "schedule_templates_admin_update" on public.schedule_templates;
drop policy if exists "schedule_templates_admin_delete" on public.schedule_templates;
drop policy if exists "schedule_templates_super_admin_all" on public.schedule_templates;

-- template_slots
drop policy if exists "template_slots_admin_read" on public.template_slots;
drop policy if exists "template_slots_admin_insert" on public.template_slots;
drop policy if exists "template_slots_admin_update" on public.template_slots;
drop policy if exists "template_slots_admin_delete" on public.template_slots;
drop policy if exists "template_slots_super_admin_all" on public.template_slots;

-- bay_schedules
drop policy if exists "bay_schedules_admin_insert" on public.bay_schedules;
drop policy if exists "bay_schedules_admin_update" on public.bay_schedules;
drop policy if exists "bay_schedules_admin_delete" on public.bay_schedules;
drop policy if exists "bay_schedules_super_admin_all" on public.bay_schedules;

-- bay_schedule_slots
drop policy if exists "bay_schedule_slots_admin_insert" on public.bay_schedule_slots;
drop policy if exists "bay_schedule_slots_admin_update" on public.bay_schedule_slots;
drop policy if exists "bay_schedule_slots_admin_delete" on public.bay_schedule_slots;
drop policy if exists "bay_schedule_slots_super_admin_all" on public.bay_schedule_slots;

-- bookings
drop policy if exists "bookings_admin_read" on public.bookings;
drop policy if exists "bookings_admin_insert" on public.bookings;
drop policy if exists "bookings_admin_update" on public.bookings;
drop policy if exists "bookings_super_admin_all" on public.bookings;

-- booking_slots
drop policy if exists "booking_slots_admin_read" on public.booking_slots;
drop policy if exists "booking_slots_super_admin_all" on public.booking_slots;

-- ============================================================
-- Re-create admin policies using is_super_admin() helper
-- (admins get org-scoped access, super admins already have
-- full access via _v2 policies from migration 00013)
-- ============================================================

-- Helper: check if user is admin for a given org_id
create or replace function public.is_org_admin(_org_id uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid()
    and role = 'admin'
    and org_id = _org_id
  );
end;
$$ language plpgsql security definer stable;

-- profiles: admins can read profiles in their org
create policy "profiles_admin_org_read_v2"
  on public.profiles for select
  using (public.is_org_admin(org_id));

-- bays: admins can CRUD bays in their org
create policy "bays_admin_all_v2"
  on public.bays for all
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

-- schedule_templates
create policy "schedule_templates_admin_all_v2"
  on public.schedule_templates for all
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

-- template_slots (join through schedule_templates to get org_id)
create policy "template_slots_admin_all_v2"
  on public.template_slots for all
  using (
    exists (
      select 1 from public.schedule_templates st
      where st.id = template_slots.template_id
      and public.is_org_admin(st.org_id)
    )
  )
  with check (
    exists (
      select 1 from public.schedule_templates st
      where st.id = template_slots.template_id
      and public.is_org_admin(st.org_id)
    )
  );

-- bay_schedules
create policy "bay_schedules_admin_all_v2"
  on public.bay_schedules for all
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

-- bay_schedule_slots
create policy "bay_schedule_slots_admin_all_v2"
  on public.bay_schedule_slots for all
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

-- bookings
create policy "bookings_admin_all_v2"
  on public.bookings for all
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

-- booking_slots (join through bookings to get org_id)
create policy "booking_slots_admin_all_v2"
  on public.booking_slots for all
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_slots.booking_id
      and public.is_org_admin(b.org_id)
    )
  )
  with check (
    exists (
      select 1 from public.bookings b
      where b.id = booking_slots.booking_id
      and public.is_org_admin(b.org_id)
    )
  );
