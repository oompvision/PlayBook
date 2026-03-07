export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { MembershipTierSettings } from "../membership-tier-settings";

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

  // Fetch org for current window settings
  const { data: orgData } = await supabase
    .from("organizations")
    .select(
      "membership_tiers_enabled, bookable_window_days, guest_booking_window_days, member_booking_window_days"
    )
    .eq("id", org.id)
    .single();

  // Fetch existing tier
  const { data: tier } = await supabase
    .from("membership_tiers")
    .select(
      "name, benefit_description, discount_type, discount_value, event_discount_type, event_discount_value, price_monthly_cents, price_yearly_cents"
    )
    .eq("org_id", org.id)
    .single();

  // Count active Stripe subscribers
  const { count } = await supabase
    .from("user_memberships")
    .select("*", { count: "exact", head: true })
    .eq("org_id", org.id)
    .eq("source", "stripe")
    .in("status", ["active", "past_due"]);

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
          Configure membership tiers, pricing, and benefits.
        </p>
      </div>

      {/* Membership Management */}
      <MembershipTierSettings
        orgId={org.id}
        initialEnabled={orgData?.membership_tiers_enabled ?? false}
        initialBookableWindowDays={orgData?.bookable_window_days ?? 30}
        initialGuestBookableWindowDays={orgData?.guest_booking_window_days ?? null}
        initialMemberBookableWindowDays={orgData?.member_booking_window_days ?? null}
        initialTier={
          tier
            ? {
                name: tier.name,
                benefit_description: tier.benefit_description,
                discount_type: tier.discount_type as "flat" | "percent",
                discount_value: Number(tier.discount_value),
                event_discount_type: (tier.event_discount_type as "flat" | "percent") ?? "percent",
                event_discount_value: Number(tier.event_discount_value ?? 0),
                price_monthly_cents: tier.price_monthly_cents,
                price_yearly_cents: tier.price_yearly_cents,
              }
            : null
        }
        stripeConnected={
          !!paymentSettings?.stripe_account_id &&
          !!paymentSettings?.stripe_onboarding_complete
        }
        activeStripeSubscriberCount={count ?? 0}
      />
    </div>
  );
}
