import { NextRequest, NextResponse } from "next/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";

/**
 * POST /api/stripe/membership-portal
 * Creates a Stripe Customer Portal session so the member can manage
 * their subscription (cancel, update payment method, etc.)
 * on the org's connected Stripe account.
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Auth
    const auth = await getAuthUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Resolve org
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
      .select("id")
      .eq("slug", slug)
      .single();

    if (!org) {
      return NextResponse.json(
        { error: "Facility not found" },
        { status: 404 }
      );
    }

    // 3. Get user's membership with Stripe customer ID
    const { data: membership } = await supabase
      .from("user_memberships")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("org_id", org.id)
      .eq("user_id", auth.user.id)
      .eq("source", "stripe")
      .single();

    if (!membership?.stripe_customer_id) {
      return NextResponse.json(
        { error: "No active Stripe membership found" },
        { status: 400 }
      );
    }

    // 4. Get connected account ID
    const { data: paymentSettings } = await supabase
      .from("org_payment_settings")
      .select("stripe_account_id")
      .eq("org_id", org.id)
      .single();

    if (!paymentSettings?.stripe_account_id) {
      return NextResponse.json(
        { error: "Facility payment setup is incomplete" },
        { status: 400 }
      );
    }

    // 5. Create Customer Portal session
    const origin = request.headers.get("origin") || request.nextUrl.origin;

    const portalSession = await stripe.billingPortal.sessions.create(
      {
        customer: membership.stripe_customer_id,
        return_url: `${origin}/membership`,
      },
      { stripeAccount: paymentSettings.stripe_account_id }
    );

    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error("[membership-portal] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
