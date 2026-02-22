-- ============================================================
-- Fix super_admin RLS policies
--
-- The existing super_admin policies check profiles.role inside
-- RLS USING clauses, but that inner query is also subject to
-- RLS on the profiles table, creating a circular failure.
--
-- Fix: create a SECURITY DEFINER helper that bypasses RLS,
-- then add new working policies for all tables.
-- ============================================================

-- Helper function that bypasses RLS to check super_admin role
create or replace function public.is_super_admin()
returns boolean as $$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid()
    and role = 'super_admin'
  );
end;
$$ language plpgsql security definer stable;

-- ============================================================
-- organizations — already has public read, just need write fix
-- ============================================================

create policy "organizations_super_admin_all_v2"
  on public.organizations for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ============================================================
-- profiles — super admin can read/write all profiles
-- ============================================================

create policy "profiles_super_admin_all_v2"
  on public.profiles for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ============================================================
-- bays
-- ============================================================

create policy "bays_super_admin_all_v2"
  on public.bays for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ============================================================
-- schedule_templates
-- ============================================================

create policy "schedule_templates_super_admin_all_v2"
  on public.schedule_templates for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ============================================================
-- template_slots
-- ============================================================

create policy "template_slots_super_admin_all_v2"
  on public.template_slots for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ============================================================
-- bay_schedules
-- ============================================================

create policy "bay_schedules_super_admin_all_v2"
  on public.bay_schedules for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ============================================================
-- bay_schedule_slots
-- ============================================================

create policy "bay_schedule_slots_super_admin_all_v2"
  on public.bay_schedule_slots for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ============================================================
-- bookings
-- ============================================================

create policy "bookings_super_admin_all_v2"
  on public.bookings for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ============================================================
-- booking_slots
-- ============================================================

create policy "booking_slots_super_admin_all_v2"
  on public.booking_slots for all
  using (public.is_super_admin())
  with check (public.is_super_admin());
