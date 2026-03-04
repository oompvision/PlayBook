import { NextRequest, NextResponse } from "next/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";

/**
 * POST /api/stripe/membership-checkout
 * Creates a Stripe Checkout Session for a membership subscription
 * on the org's connected Stripe account.
 *
 * Body: { interval: 'month' | 'year' }
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Auth — customer must be logged in
    const auth = await getAuthUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { interval } = (await request.json()) as {
      interval: "month" | "year";
    };

    if (!interval || !["month", "year"].includes(interval)) {
      return NextResponse.json(
        { error: "interval must be 'month' or 'year'" },
        { status: 400 }
      );
    }

    // 2. Resolve org from facility slug
    const slug = await getFacilitySlug();
    if (!slug) {
      return NextResponse.json(
        { error: "Facility not found" },
        { status: 404 }
      );
    }

    const supabase = createServiceClient();

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, slug, membership_tiers_enabled")
      .eq("slug", slug)
      .single();

    if (!org || !org.membership_tiers_enabled) {
      return NextResponse.json(
        { error: "Membership is not available for this facility" },
        { status: 400 }
      );
    }

    // 3. Get membership tier
    const { data: tier } = await supabase
      .from("membership_tiers")
      .select(
        "id, name, stripe_product_id, stripe_price_monthly_id, stripe_price_yearly_id, price_monthly_cents, price_yearly_cents"
      )
      .eq("org_id", org.id)
      .single();

    if (!tier) {
      return NextResponse.json(
        { error: "Membership tier not configured" },
        { status: 400 }
      );
    }

    const stripePriceId =
      interval === "month"
        ? tier.stripe_price_monthly_id
        : tier.stripe_price_yearly_id;

    if (!stripePriceId) {
      return NextResponse.json(
        { error: `${interval === "month" ? "Monthly" : "Yearly"} plan is not available` },
        { status: 400 }
      );
    }

    // 4. Check if user already has an active membership
    const { data: existingMembership } = await supabase
      .from("user_memberships")
      .select("id, status, current_period_end")
      .eq("org_id", org.id)
      .eq("user_id", auth.user.id)
      .single();

    if (existingMembership) {
      const isActive =
        existingMembership.status === "active" ||
        existingMembership.status === "admin_granted" ||
        (existingMembership.status === "cancelled" &&
          existingMembership.current_period_end &&
          new Date(existingMembership.current_period_end) > new Date());

      if (isActive) {
        return NextResponse.json(
          { error: "You already have an active membership" },
          { status: 400 }
        );
      }
    }

    // 5. Get Stripe Connect account
    const { data: paymentSettings } = await supabase
      .from("org_payment_settings")
      .select("stripe_account_id, stripe_onboarding_complete")
      .eq("org_id", org.id)
      .single();

    if (
      !paymentSettings?.stripe_account_id ||
      !paymentSettings?.stripe_onboarding_complete
    ) {
      return NextResponse.json(
        { error: "Facility payment setup is incomplete" },
        { status: 400 }
      );
    }

    const stripeAccountId = paymentSettings.stripe_account_id;

    // 6. Find or create Stripe Customer on connected account
    let stripeCustomerId: string | null = null;

    // Check user_memberships first for existing customer ID
    if (existingMembership) {
      const { data: membershipWithCustomer } = await supabase
        .from("user_memberships")
        .select("stripe_customer_id")
        .eq("org_id", org.id)
        .eq("user_id", auth.user.id)
        .not("stripe_customer_id", "is", null)
        .single();

      stripeCustomerId = membershipWithCustomer?.stripe_customer_id ?? null;
    }

    // Fall back to booking_payments customer lookup
    if (!stripeCustomerId) {
      const { data: existingPayment } = await supabase
        .from("booking_payments")
        .select("stripe_customer_id")
        .eq("org_id", org.id)
        .eq("customer_email", auth.profile.email)
        .not("stripe_customer_id", "is", null)
        .limit(1)
        .single();

      stripeCustomerId = existingPayment?.stripe_customer_id ?? null;
    }

    // Create new customer on connected account if needed
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create(
        {
          email: auth.profile.email,
          name: auth.profile.full_name || undefined,
          metadata: {
            profile_id: auth.profile.id,
            org_id: org.id,
          },
        },
        { stripeAccount: stripeAccountId }
      );
      stripeCustomerId = customer.id;
    }

    // 7. Create Stripe Checkout Session
    const origin = request.headers.get("origin") || request.nextUrl.origin;

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: stripeCustomerId,
        line_items: [{ price: stripePriceId, quantity: 1 }],
        success_url: `${origin}/membership?success=true`,
        cancel_url: `${origin}/membership?cancelled=true`,
        subscription_data: {
          metadata: {
            org_id: org.id,
            user_id: auth.user.id,
            tier_id: tier.id,
          },
        },
        metadata: {
          org_id: org.id,
          user_id: auth.user.id,
          tier_id: tier.id,
        },
      },
      { stripeAccount: stripeAccountId }
    );

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[membership-checkout] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
