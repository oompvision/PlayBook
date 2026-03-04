import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import { MembershipPage } from "@/components/membership-page";

export default async function MembershipRoute({
  searchParams: searchParamsPromise,
}: {
  searchParams?: Promise<{ [key: string]: string | undefined }>;
}) {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  const searchParams = searchParamsPromise ? await searchParamsPromise : {};

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select(
      "id, name, slug, membership_tiers_enabled, guest_booking_window_days, member_booking_window_days, bookable_window_days"
    )
    .eq("slug", slug)
    .single();

  if (!org || !org.membership_tiers_enabled) {
    redirect("/");
  }

  // Fetch tier info (public read via RLS)
  const { data: tier } = await supabase
    .from("membership_tiers")
    .select(
      "id, name, benefit_description, discount_type, discount_value, price_monthly_cents, price_yearly_cents"
    )
    .eq("org_id", org.id)
    .single();

  if (!tier) {
    redirect("/");
  }

  // Check auth status
  const auth = await getAuthUser();

  // Fetch user's membership if authenticated
  let membership: {
    status: string;
    source: string;
    current_period_end: string | null;
    expires_at: string | null;
    cancelled_at: string | null;
    stripe_subscription_id: string | null;
  } | null = null;

  if (auth) {
    // Use service client to reliably read membership (customer RLS only allows own reads)
    const serviceClient = createServiceClient();
    const { data } = await serviceClient
      .from("user_memberships")
      .select(
        "status, source, current_period_end, expires_at, cancelled_at, stripe_subscription_id"
      )
      .eq("org_id", org.id)
      .eq("user_id", auth.user.id)
      .single();

    membership = data;
  }

  // Determine if user has active perks
  const now = new Date();
  const hasActivePerks = membership
    ? (membership.status === "active" &&
        (!membership.current_period_end ||
          new Date(membership.current_period_end) > now)) ||
      (membership.status === "admin_granted" &&
        (!membership.expires_at || new Date(membership.expires_at) > now)) ||
      (membership.status === "cancelled" &&
        membership.current_period_end &&
        new Date(membership.current_period_end) > now)
    : false;

  return (
    <div className="flex-1 py-6">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <MembershipPage
          orgName={org.name}
          tier={{
            name: tier.name,
            benefitDescription: tier.benefit_description,
            discountType: tier.discount_type as "flat" | "percent",
            discountValue: Number(tier.discount_value),
            priceMonthly: tier.price_monthly_cents,
            priceYearly: tier.price_yearly_cents,
          }}
          guestWindow={
            org.guest_booking_window_days ?? org.bookable_window_days ?? 30
          }
          memberWindow={
            org.member_booking_window_days ?? org.bookable_window_days ?? 30
          }
          isAuthenticated={!!auth}
          membership={
            membership
              ? {
                  status: membership.status,
                  source: membership.source,
                  currentPeriodEnd: membership.current_period_end,
                  expiresAt: membership.expires_at,
                  cancelledAt: membership.cancelled_at,
                  hasActivePerks,
                }
              : null
          }
          showSuccess={searchParams.success === "true"}
          showCancelled={searchParams.cancelled === "true"}
        />
      </div>
    </div>
  );
}
