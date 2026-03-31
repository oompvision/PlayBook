import { z } from "zod/v4";

export const grantMembershipSchema = z.object({
  org_id: z.string().uuid(),
  user_id: z.string().uuid(),
  tier_id: z.string().uuid().optional(),
});

export const revokeMembershipSchema = z.object({
  membership_id: z.string().uuid(),
  org_id: z.string().uuid(),
});

const tierConfigSchema = z.object({
  id: z.string().uuid().optional(),
  sort_order: z.number().int().min(1).max(10),
  tier_name: z.string().max(200),
  benefit_description: z.string().max(2000).optional(),
  discount_type: z.enum(["flat", "percent"]),
  discount_value: z.number().min(0),
  event_discount_type: z.enum(["flat", "percent"]).optional(),
  event_discount_value: z.number().min(0).optional(),
  price_monthly_cents: z.number().int().min(0).nullable().optional(),
  price_yearly_cents: z.number().int().min(0).nullable().optional(),
  bookable_window_days: z.number().int().min(1).max(365).nullable().optional(),
  credit_amount: z.number().int().min(0).nullable().optional(),
  credit_period: z.enum(["daily", "weekly", "monthly"]).nullable().optional(),
});

export type TierConfig = z.infer<typeof tierConfigSchema>;

export const membershipTiersSchema = z.object({
  enabled: z.boolean(),
  guest_booking_window_days: z.number().int().min(1).max(365).optional(),
  credit_type: z.enum(["hours", "value"]).nullable().optional(),
  tiers: z.array(tierConfigSchema).max(10).optional(),
});

// Keep legacy single-tier schema for backwards compat during migration
export const membershipTierSchema = z.object({
  enabled: z.boolean(),
  tier_name: z.string().max(200).optional(),
  benefit_description: z.string().max(2000).optional(),
  discount_type: z.enum(["flat", "percent"]).optional(),
  discount_value: z.number().min(0).optional(),
  event_discount_type: z.enum(["flat", "percent"]).nullish(),
  event_discount_value: z.number().min(0).nullish(),
  price_monthly_cents: z.number().int().min(0).optional(),
  price_yearly_cents: z.number().int().min(0).optional(),
  guest_booking_window_days: z.number().int().min(1).max(365).optional(),
  member_booking_window_days: z.number().int().min(1).max(365).optional(),
});

export const schedulingModeSchema = z.object({
  scheduling_type: z.enum(["slot_based", "dynamic", "events_only"]),
  bookable_window_days: z.number().int().min(1).max(365),
});

export const eventsSettingsSchema = z.object({
  events_enabled: z.boolean(),
});
