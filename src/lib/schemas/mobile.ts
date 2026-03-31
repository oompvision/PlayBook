import { z } from "zod/v4";

export const mobilePaymentIntentSchema = z.object({
  org_id: z.string().uuid(),
  type: z.enum(["slot_booking", "dynamic_booking", "event"]),
  slot_ids: z.array(z.string().uuid()).optional(),
  price_cents: z.number().int().min(0).optional(),
  event_id: z.string().uuid().optional(),
  registration_id: z.string().uuid().optional(),
  location_id: z.string().uuid().nullish(),
  discount_cents: z.number().int().min(0).optional(),
});

export const mobileRecordPaymentSchema = z.object({
  org_id: z.string().uuid(),
  booking_id: z.string().uuid().optional(),
  event_registration_id: z.string().uuid().optional(),
  intent_id: z.string().min(1),
  intent_type: z.enum(["payment", "setup"]),
  stripe_customer_id: z.string().min(1),
  stripe_payment_method_id: z.string().optional(),
  amount_cents: z.number().int().min(0),
  cancellation_policy_text: z.string().optional(),
  policy_agreed_at: z.string().optional(),
});
