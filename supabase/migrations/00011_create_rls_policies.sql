-- ============================================================
-- 11. RLS Policies (role-based)
-- All policies that reference public.profiles for role checks.
-- Must run AFTER all tables are created (00001-00009).
-- ============================================================

-- ============================================================
-- organizations policies
-- ============================================================

create policy "organizations_super_admin_insert"
  on public.organizations for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

create policy "organizations_super_admin_update"
  on public.organizations for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- ============================================================
-- profiles policies (admin/super_admin cross-row access)
-- ============================================================

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

create policy "profiles_super_admin_read"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles as p
      where p.id = auth.uid()
      and p.role = 'super_admin'
    )
  );

create policy "profiles_super_admin_insert"
  on public.profiles for insert
  with check (
    exists (
      select 1 from public.profiles as p
      where p.id = auth.uid()
      and p.role = 'super_admin'
    )
  );

create policy "profiles_super_admin_update"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles as p
      where p.id = auth.uid()
      and p.role = 'super_admin'
    )
  );

-- ============================================================
-- bays policies
-- ============================================================

create policy "bays_admin_read"
  on public.bays for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bays.org_id
    )
  );

create policy "bays_admin_insert"
  on public.bays for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bays.org_id
    )
  );

create policy "bays_admin_update"
  on public.bays for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bays.org_id
    )
  );

create policy "bays_super_admin_all"
  on public.bays for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- ============================================================
-- schedule_templates policies
-- ============================================================

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

create policy "schedule_templates_super_admin_all"
  on public.schedule_templates for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- ============================================================
-- template_slots policies
-- ============================================================

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

create policy "template_slots_super_admin_all"
  on public.template_slots for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- ============================================================
-- bay_schedules policies
-- ============================================================

create policy "bay_schedules_admin_insert"
  on public.bay_schedules for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bay_schedules.org_id
    )
  );

create policy "bay_schedules_admin_update"
  on public.bay_schedules for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bay_schedules.org_id
    )
  );

create policy "bay_schedules_admin_delete"
  on public.bay_schedules for delete
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bay_schedules.org_id
    )
  );

create policy "bay_schedules_super_admin_all"
  on public.bay_schedules for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- ============================================================
-- bay_schedule_slots policies
-- ============================================================

create policy "bay_schedule_slots_admin_insert"
  on public.bay_schedule_slots for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bay_schedule_slots.org_id
    )
  );

create policy "bay_schedule_slots_admin_update"
  on public.bay_schedule_slots for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bay_schedule_slots.org_id
    )
  );

create policy "bay_schedule_slots_admin_delete"
  on public.bay_schedule_slots for delete
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bay_schedule_slots.org_id
    )
  );

create policy "bay_schedule_slots_super_admin_all"
  on public.bay_schedule_slots for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- ============================================================
-- bookings policies (admin/super_admin)
-- ============================================================

create policy "bookings_admin_read"
  on public.bookings for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bookings.org_id
    )
  );

create policy "bookings_admin_insert"
  on public.bookings for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bookings.org_id
    )
  );

create policy "bookings_admin_update"
  on public.bookings for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.org_id = bookings.org_id
    )
  );

create policy "bookings_super_admin_all"
  on public.bookings for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );

-- ============================================================
-- booking_slots policies (admin/super_admin)
-- ============================================================

create policy "booking_slots_admin_read"
  on public.booking_slots for select
  using (
    exists (
      select 1 from public.bookings b
      join public.profiles p on p.org_id = b.org_id
      where b.id = booking_slots.booking_id
      and p.id = auth.uid()
      and p.role = 'admin'
    )
  );

create policy "booking_slots_super_admin_all"
  on public.booking_slots for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
    )
  );
