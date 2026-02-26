-- admin_invitations: tracks invites sent by super admin
CREATE TABLE public.admin_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  invited_by uuid NOT NULL REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE(org_id, email)
);

-- admin_profiles: 1:1 extension of profiles for admin-specific fields
-- PK = profiles.id (direct reference, not a separate column)
CREATE TABLE public.admin_profiles (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_admin_invitations_org_id ON public.admin_invitations(org_id);
CREATE INDEX idx_admin_invitations_email ON public.admin_invitations(email);

-- Triggers (reuse existing handle_updated_at)
CREATE TRIGGER set_admin_invitations_updated_at
  BEFORE UPDATE ON public.admin_invitations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_admin_profiles_updated_at
  BEFORE UPDATE ON public.admin_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS
ALTER TABLE public.admin_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;

-- admin_invitations: super_admin full access
CREATE POLICY "admin_invitations_super_admin" ON public.admin_invitations
  FOR ALL USING (public.is_super_admin());

-- admin_profiles: self read/write + super_admin all
CREATE POLICY "admin_profiles_self_select" ON public.admin_profiles
  FOR SELECT USING (id = auth.uid());
CREATE POLICY "admin_profiles_self_insert" ON public.admin_profiles
  FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "admin_profiles_self_update" ON public.admin_profiles
  FOR UPDATE USING (id = auth.uid());
CREATE POLICY "admin_profiles_super_admin" ON public.admin_profiles
  FOR ALL USING (public.is_super_admin());
