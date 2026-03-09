-- Allow authenticated customers to read org_payment_settings for their org
-- This is needed for the mobile app to show cancellation window warnings
-- and policy agreement text during booking and cancellation flows.
CREATE POLICY "org_payment_settings_customer_select"
  ON public.org_payment_settings FOR SELECT
  USING (
    org_id IN (
      SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  );
