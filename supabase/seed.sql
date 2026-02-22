-- ============================================================
-- Seed data for PlayBook
-- Run this AFTER migrations and AFTER creating the super admin
-- user in Supabase Auth (anthony@sidelineswap.com)
-- ============================================================

-- NOTE: The super admin profile will be auto-created by the
-- handle_new_user trigger when the auth user is created.
-- You need to manually update the role to 'super_admin'
-- and set org_id to null:
--
--   UPDATE public.profiles
--   SET role = 'super_admin', org_id = null
--   WHERE email = 'anthony@sidelineswap.com';

-- ============================================================
-- Demo organizations
-- ============================================================

insert into public.organizations (id, name, slug, timezone, default_slot_duration_minutes, description, address)
values
  (
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'Justin Koff Golf Sim',
    'justin-koff-golf-sim',
    'America/New_York',
    60,
    'Premium indoor golf simulator experience with TrackMan technology. Perfect your swing year-round.',
    '123 Fairway Drive, Boston, MA 02101'
  ),
  (
    'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    'Coffee & Tee',
    'coffee-and-tee',
    'America/New_York',
    60,
    'Where coffee meets golf. Enjoy a latte while crushing drives on our state-of-the-art simulators.',
    '456 Links Avenue, Cambridge, MA 02139'
  )
on conflict (slug) do nothing;

-- ============================================================
-- Demo bays for Justin Koff Golf Sim
-- ============================================================

insert into public.bays (org_id, name, description, resource_type, equipment_info, hourly_rate_cents, sort_order, is_active)
values
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Bay 1', 'Private simulator bay with lounge seating', 'Golf Simulator', 'TrackMan iO', 6000, 1, true),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Bay 2', 'Private simulator bay with lounge seating', 'Golf Simulator', 'TrackMan iO', 6000, 2, true),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Bay 3', 'Premium bay with extra space for groups', 'Golf Simulator', 'TrackMan iO Launch Monitor', 7500, 3, true),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'The Tour Suite', 'Our flagship bay with tour-level setup', 'Golf Simulator', 'Full Swing Kit', 10000, 4, true)
on conflict do nothing;

-- ============================================================
-- Demo bays for Coffee & Tee
-- ============================================================

insert into public.bays (org_id, name, description, resource_type, equipment_info, hourly_rate_cents, sort_order, is_active)
values
  ('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'Espresso Bay', 'Cozy bay next to the coffee bar', 'Golf Simulator', 'SkyTrak+', 4500, 1, true),
  ('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'Latte Lounge', 'Open-concept bay with comfortable seating', 'Golf Simulator', 'SkyTrak+', 4500, 2, true),
  ('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'The Roast Room', 'Private room for groups and events', 'Golf Simulator', 'Uneekor QED', 6000, 3, true)
on conflict do nothing;
