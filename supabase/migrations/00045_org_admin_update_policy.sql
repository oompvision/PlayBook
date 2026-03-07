-- Allow facility admins to update their own organization record
-- Fixes: events_enabled (and other settings) silently failing to save for non-super-admin users
create policy "organizations_admin_update"
  on public.organizations for update
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));
