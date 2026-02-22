-- ============================================================
-- Super admin first-time setup
-- Allows the first authenticated user to claim super_admin role.
-- Only works when no super_admin exists yet.
-- ============================================================

-- Allow users to insert their own profile (handles case where
-- the on_auth_user_created trigger didn't fire)
create policy "profiles_self_insert"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Function to get the current user's profile, bypassing RLS.
-- Used by server components that already verified auth via getUser().
create or replace function public.get_my_profile()
returns json as $$
begin
  return (
    select row_to_json(p)
    from public.profiles p
    where p.id = auth.uid()
  );
end;
$$ language plpgsql security definer;

-- Function to claim super_admin role.
-- Creates profile if missing, promotes to super_admin.
-- Returns false if a super_admin already exists.
create or replace function public.claim_super_admin()
returns boolean as $$
declare
  _has_super_admin boolean;
  _user_email text;
begin
  -- Check if any super_admin already exists
  select exists(
    select 1 from public.profiles where role = 'super_admin'
  ) into _has_super_admin;

  if _has_super_admin then
    return false;
  end if;

  -- Get the current user's email
  select email into _user_email from auth.users where id = auth.uid();

  -- Upsert profile with super_admin role
  insert into public.profiles (id, email, role)
  values (auth.uid(), _user_email, 'super_admin')
  on conflict (id) do update set role = 'super_admin';

  return true;
end;
$$ language plpgsql security definer;
