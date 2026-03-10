-- Add email branding columns to organizations
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS brand_color text DEFAULT '#18181b',
  ADD COLUMN IF NOT EXISTS email_from_name text;

-- email_from_name: overrides the "From" name in emails (e.g., "Pickle & Par")
-- If null, falls back to organizations.name
-- brand_color: hex color used in email template headers/buttons
