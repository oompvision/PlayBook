-- Create template_bay_overrides table for per-bay price customization on template slots
-- When an admin edits a slot's price for a specific bay, the override is stored here.
-- If no override exists, the price is computed from the bay's hourly_rate_cents at apply time.

CREATE TABLE IF NOT EXISTS public.template_bay_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.schedule_templates(id) ON DELETE CASCADE,
  bay_id uuid NOT NULL REFERENCES public.bays(id) ON DELETE CASCADE,
  template_slot_id uuid NOT NULL REFERENCES public.template_slots(id) ON DELETE CASCADE,
  price_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_slot_id, bay_id)
);

-- Indexes for efficient lookups
CREATE INDEX idx_template_bay_overrides_template ON public.template_bay_overrides(template_id);
CREATE INDEX idx_template_bay_overrides_bay ON public.template_bay_overrides(bay_id);

-- Enable RLS
ALTER TABLE public.template_bay_overrides ENABLE ROW LEVEL SECURITY;

-- Admin access scoped to their org (via schedule_templates join)
CREATE POLICY "Admins can manage template bay overrides"
  ON public.template_bay_overrides
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.schedule_templates t
      WHERE t.id = template_bay_overrides.template_id
      AND is_org_admin(t.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.schedule_templates t
      WHERE t.id = template_bay_overrides.template_id
      AND is_org_admin(t.org_id)
    )
  );

-- Super admin full access
CREATE POLICY "Super admins have full access to template bay overrides"
  ON public.template_bay_overrides
  FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());
