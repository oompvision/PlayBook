-- ============================================================
-- 17. Add cover_photo_url to organizations + org-assets storage bucket
-- ============================================================

-- Add cover_photo_url column (logo_url already exists from 00001)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS cover_photo_url text;

-- Create a public storage bucket for org assets (logos, cover photos)
INSERT INTO storage.buckets (id, name, public)
VALUES ('org-assets', 'org-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can view org assets (logos/cover photos are public)
CREATE POLICY "org_assets_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'org-assets');

-- Authenticated users can upload org assets (app-level admin check enforced)
CREATE POLICY "org_assets_auth_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'org-assets' AND auth.role() = 'authenticated');

-- Authenticated users can overwrite org assets
CREATE POLICY "org_assets_auth_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'org-assets' AND auth.role() = 'authenticated');

-- Authenticated users can delete org assets
CREATE POLICY "org_assets_auth_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'org-assets' AND auth.role() = 'authenticated');
