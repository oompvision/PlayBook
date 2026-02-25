-- Drop price_cents from template_slots
-- Pricing is now derived from each bay's hourly_rate_cents when templates are applied
alter table public.template_slots drop column if exists price_cents;
