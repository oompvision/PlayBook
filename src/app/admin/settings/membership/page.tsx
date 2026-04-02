export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { MembershipTiersSettings } from "../membership-tiers-settings";
import { SettingsAccordion } from "@/components/admin/settings-accordion";
import { Crown } from "lucide-react";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function MembershipManagementPage() {
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();

  // Fetch org settings
  const { data: orgData } = await supabase
    .from("organizations")
    .select(
      "membership_tiers_enabled, bookable_window_days, guest_booking_window_days, member_booking_window_days, credit_type"
    )
    .eq("id", org.id)
    .single();

  // Fetch all tiers for this org (multi-tier)
  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select(
      "id, sort_order, name, benefit_description, discount_type, discount_value, event_discount_type, event_discount_value, price_monthly_cents, price_yearly_cents, bookable_window_days, credit_amount, credit_period"
    )
    .eq("org_id", org.id)
    .order("sort_order", { ascending: true });

  // Count active Stripe subscribers per tier
  const { data: subscribers } = await supabase
    .from("user_memberships")
    .select("tier_id")
    .eq("org_id", org.id)
    .eq("source", "stripe")
    .in("status", ["active", "past_due"]);

  const tierSubscriberCounts: Record<string, number> = {};
  let totalActiveSubscribers = 0;
  for (const sub of subscribers || []) {
    tierSubscriberCounts[sub.tier_id] = (tierSubscriberCounts[sub.tier_id] || 0) + 1;
    totalActiveSubscribers++;
  }

  // Check Stripe Connect status
  const { data: paymentSettings } = await supabase
    .from("org_payment_settings")
    .select("stripe_account_id, stripe_onboarding_complete")
    .eq("org_id", org.id)
    .single();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Membership Management
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Configure membership tiers, pricing, credits, and benefits.
        </p>
      </div>

      {/* Membership Management */}
      <SettingsAccordion
        icon={<Crown className="h-[18px] w-[18px] text-gray-500 dark:text-gray-400" />}
        title="Membership Tiers"
        description="Offer tiered memberships with different pricing, discounts, credits, and booking perks."
        defaultOpen
      >
        <MembershipTiersSettings
          orgId={org.id}
          initialEnabled={orgData?.membership_tiers_enabled ?? false}
          initialBookableWindowDays={orgData?.bookable_window_days ?? 30}
          initialGuestBookableWindowDays={orgData?.guest_booking_window_days ?? null}
          initialCreditType={(orgData?.credit_type as "hours" | "value" | null) ?? null}
          initialTiers={
            (tiers || []).map((t) => ({
              id: t.id,
              sort_order: t.sort_order ?? 1,
              name: t.name,
              benefit_description: t.benefit_description,
              discount_type: t.discount_type as "flat" | "percent",
              discount_value: Number(t.discount_value),
              event_discount_type: (t.event_discount_type as "flat" | "percent") ?? "percent",
              event_discount_value: Number(t.event_discount_value ?? 0),
              price_monthly_cents: t.price_monthly_cents,
              price_yearly_cents: t.price_yearly_cents,
              bookable_window_days: t.bookable_window_days,
              credit_amount: t.credit_amount,
              credit_period: t.credit_period as "daily" | "weekly" | "monthly" | null,
            }))
          }
          stripeConnected={
            !!paymentSettings?.stripe_account_id &&
            !!paymentSettings?.stripe_onboarding_complete
          }
          activeStripeSubscriberCount={totalActiveSubscribers}
          tierSubscriberCounts={tierSubscriberCounts}
        />
      </SettingsAccordion>
    </div>
  );
}
