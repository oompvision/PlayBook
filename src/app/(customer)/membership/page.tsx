import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import { MembershipPage } from "@/components/membership-page";
import { stripe } from "@/lib/stripe";

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
      "id, name, slug, membership_tiers_enabled, guest_booking_window_days, member_booking_window_days, bookable_window_days, credit_type"
    )
    .eq("slug", slug)
    .single();

  if (!org || !org.membership_tiers_enabled) {
    redirect("/");
  }

  // Fetch all tiers (public read via RLS)
  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select(
      "id, sort_order, name, benefit_description, discount_type, discount_value, price_monthly_cents, price_yearly_cents, bookable_window_days, credit_amount, credit_period"
    )
    .eq("org_id", org.id)
    .order("sort_order", { ascending: true });

  if (!tiers || tiers.length === 0) {
    redirect("/");
  }

  // Check auth status
  const auth = await getAuthUser();

  // If returning from Stripe checkout with session_id, verify and upsert membership
  if (auth && searchParams.success === "true" && searchParams.session_id) {
    const serviceClient = createServiceClient();
    try {
      const { data: paymentSettings } = await serviceClient
        .from("org_payment_settings")
        .select("stripe_account_id")
        .eq("org_id", org.id)
        .single();

      if (paymentSettings?.stripe_account_id) {
        const session = await stripe.checkout.sessions.retrieve(
          searchParams.session_id,
          { expand: ["subscription"] },
          { stripeAccount: paymentSettings.stripe_account_id }
        );

        if (
          session.mode === "subscription" &&
          session.subscription &&
          session.status === "complete"
        ) {
          const sub =
            typeof session.subscription === "string"
              ? await stripe.subscriptions.retrieve(
                  session.subscription,
                  { expand: ["items.data"] },
                  { stripeAccount: paymentSettings.stripe_account_id }
                )
              : session.subscription;

          const firstItem = sub.items?.data?.[0];
          const periodEndTs = firstItem?.current_period_end;
          const periodEndIso = periodEndTs
            ? new Date(periodEndTs * 1000).toISOString()
            : null;

          // Get the tier_id from subscription metadata
          const tierId = sub.metadata?.tier_id || tiers[0].id;

          await serviceClient.from("user_memberships").upsert(
            {
              org_id: org.id,
              user_id: auth.user.id,
              tier_id: tierId,
              status: "active",
              source: "stripe",
              stripe_subscription_id: sub.id,
              stripe_customer_id: session.customer as string,
              current_period_end: periodEndIso,
              cancelled_at: null,
            },
            { onConflict: "org_id,user_id" }
          );
        }
      }
    } catch (err) {
      console.error("[membership] Session verification failed:", err);
    }
  }

  // Fetch user's membership if authenticated
  let membership: {
    status: string;
    source: string;
    tier_id: string;
    current_period_end: string | null;
    expires_at: string | null;
    cancelled_at: string | null;
    stripe_subscription_id: string | null;
  } | null = null;

  if (auth) {
    const serviceClient = createServiceClient();
    const { data } = await serviceClient
      .from("user_memberships")
      .select(
        "status, source, tier_id, current_period_end, expires_at, cancelled_at, stripe_subscription_id"
      )
      .eq("org_id", org.id)
      .eq("user_id", auth.user.id)
      .single();

    membership = data;
  }

  // Determine if user has active perks
  const now = new Date();
  const hasActivePerks = membership
    ? !!(
        (membership.status === "active" &&
          (!membership.current_period_end ||
            new Date(membership.current_period_end) > now)) ||
        (membership.status === "admin_granted" &&
          (!membership.expires_at || new Date(membership.expires_at) > now)) ||
        (membership.status === "cancelled" &&
          membership.current_period_end &&
          new Date(membership.current_period_end) > now)
      )
    : false;

  // Fetch credit balance if member
  let creditBalance: {
    has_credits: boolean;
    credits_total: number;
    credits_used: number;
    credits_remaining: number;
    credit_type: string | null;
    credit_period: string | null;
    period_end: string | null;
  } | null = null;

  if (auth && hasActivePerks) {
    const serviceClient = createServiceClient();
    const { data } = await serviceClient.rpc("get_or_create_credit_balance", {
      p_org_id: org.id,
      p_user_id: auth.user.id,
    });
    creditBalance = data;
  }

  return (
    <div className="flex-1 py-6">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <MembershipPage
          orgName={org.name}
          tiers={tiers.map((t) => ({
            id: t.id,
            sortOrder: t.sort_order ?? 1,
            name: t.name,
            benefitDescription: t.benefit_description,
            discountType: t.discount_type as "flat" | "percent",
            discountValue: Number(t.discount_value),
            priceMonthly: t.price_monthly_cents,
            priceYearly: t.price_yearly_cents,
            bookableWindowDays: t.bookable_window_days,
            creditAmount: t.credit_amount,
            creditPeriod: t.credit_period as "daily" | "weekly" | "monthly" | null,
          }))}
          creditType={(org.credit_type as "hours" | "value" | null) ?? null}
          guestWindow={
            org.guest_booking_window_days ?? org.bookable_window_days ?? 30
          }
          defaultMemberWindow={
            org.member_booking_window_days ?? org.bookable_window_days ?? 30
          }
          isAuthenticated={!!auth}
          membership={
            membership
              ? {
                  status: membership.status,
                  source: membership.source,
                  tierId: membership.tier_id,
                  currentPeriodEnd: membership.current_period_end,
                  expiresAt: membership.expires_at,
                  cancelledAt: membership.cancelled_at,
                  hasActivePerks,
                }
              : null
          }
          creditBalance={creditBalance}
          showSuccess={searchParams.success === "true"}
          showCancelled={searchParams.cancelled === "true"}
        />
      </div>
    </div>
  );
}
