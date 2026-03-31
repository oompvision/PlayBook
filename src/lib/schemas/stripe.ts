import { z } from "zod/v4";

export const checkoutIntentSchema = z.object({
  slot_ids: z.array(z.string().uuid()).min(1),
  location_id: z.string().uuid().nullish(),
  discount_cents: z.number().int().min(0).optional(),
});

export const checkoutIntentDynamicSchema = z.object({
  price_cents: z.number().int().min(0),
  location_id: z.string().uuid().nullish(),
  discount_cents: z.number().int().min(0).optional(),
});

export const eventCheckoutIntentSchema = z.object({
  event_id: z.string().uuid(),
  registration_id: z.string().uuid(),
  discount_cents: z.number().int().min(0).optional(),
});

export const recordBookingPaymentSchema = z.object({
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

export const modifyBookingPaymentSchema = z.object({
  old_booking_id: z.string().uuid(),
  new_booking_id: z.string().uuid(),
  new_amount_cents: z.number().int().min(0),
});

export const refundSchema = z.object({
  booking_id: z.string().uuid(),
  refund_type: z.enum(["full", "partial"]),
  amount_cents: z.number().int().min(1).optional(),
  amount_percent: z.number().min(1).max(100).optional(),
  note: z.string().max(500).optional(),
});

export const cancelIntentSchema = z.object({
  intent_id: z.string().min(1),
  intent_type: z.enum(["payment", "setup"]),
});

export const autoRefundSchema = z.object({
  booking_id: z.string().uuid(),
});

export const membershipCheckoutSchema = z.object({
  interval: z.enum(["month", "year"]),
});
