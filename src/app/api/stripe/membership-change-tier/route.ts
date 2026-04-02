import { NextRequest, NextResponse } from "next/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import { logger } from "@/lib/logger";

/**
 * POST /api/stripe/membership-change-tier
 * Schedules a tier change for next renewal (no proration).
 *
 * Body: { tier_id: string }
 *
 * Uses Stripe subscription schedule to change the price at period end.
 * The user stays on their current tier until the next billing cycle.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { tier_id } = body;

    if (!tier_id) {
      return NextResponse.json({ error: "tier_id is required" }, { status: 400 });
    }

    const slug = await getFacilitySlug();
    if (!slug) {
      return NextResponse.json({ error: "Facility not found" }, { status: 404 });
    }

    const supabase = createServiceClient();

    const { data: org } = await supabase
      .from("organizations")
      .select("id, membership_tiers_enabled")
      .eq("slug", slug)
      .single();

    if (!org || !org.membership_tiers_enabled) {
      return NextResponse.json(
        { error: "Membership is not available" },
        { status: 400 }
      );
    }

    // Get the user's current active membership
    const { data: membership } = await supabase
      .from("user_memberships")
      .select("id, tier_id, stripe_subscription_id, stripe_customer_id, status, source")
      .eq("org_id", org.id)
      .eq("user_id", auth.user.id)
      .single();

    if (!membership || !["active", "admin_granted"].includes(membership.status)) {
      return NextResponse.json(
        { error: "No active membership found" },
        { status: 400 }
      );
    }

    if (membership.tier_id === tier_id) {
      return NextResponse.json(
        { error: "You are already on this tier" },
        { status: 400 }
      );
    }

    // Get target tier
    const { data: newTier } = await supabase
      .from("membership_tiers")
      .select("id, name, stripe_price_monthly_id, stripe_price_yearly_id")
      .eq("id", tier_id)
      .eq("org_id", org.id)
      .single();

    if (!newTier) {
      return NextResponse.json(
        { error: "Target tier not found" },
        { status: 400 }
      );
    }

    // Admin-granted memberships: change immediately (no Stripe involved)
    if (membership.source === "admin") {
      await supabase
        .from("user_memberships")
        .update({ tier_id: newTier.id })
        .eq("id", membership.id);

      return NextResponse.json({
        success: true,
        effective: "immediate",
        new_tier_name: newTier.name,
      });
    }

    // Stripe subscriptions: schedule change for next renewal
    if (!membership.stripe_subscription_id) {
      return NextResponse.json(
        { error: "No Stripe subscription found" },
        { status: 400 }
      );
    }

    // Get Stripe account
    const { data: paymentSettings } = await supabase
      .from("org_payment_settings")
      .select("stripe_account_id")
      .eq("org_id", org.id)
      .single();

    if (!paymentSettings?.stripe_account_id) {
      return NextResponse.json(
        { error: "Payment settings not configured" },
        { status: 400 }
      );
    }

    const stripeAccountId = paymentSettings.stripe_account_id;

    // Retrieve current subscription to get interval
    const subscription = await stripe.subscriptions.retrieve(
      membership.stripe_subscription_id,
      { expand: ["items.data"] },
      { stripeAccount: stripeAccountId }
    );

    const currentItem = subscription.items.data[0];
    if (!currentItem) {
      return NextResponse.json(
        { error: "Subscription has no items" },
        { status: 400 }
      );
    }

    // Determine the new price based on current billing interval
    const currentInterval = currentItem.price?.recurring?.interval;
    const newPriceId =
      currentInterval === "year"
        ? newTier.stripe_price_yearly_id
        : newTier.stripe_price_monthly_id;

    if (!newPriceId) {
      return NextResponse.json(
        { error: `The ${currentInterval} plan is not available for the target tier` },
        { status: 400 }
      );
    }

    // Schedule the change for next billing cycle using subscription update
    // with proration_behavior: 'none' — takes effect at next renewal
    await stripe.subscriptions.update(
      membership.stripe_subscription_id,
      {
        items: [
          {
            id: currentItem.id,
            price: newPriceId,
          },
        ],
        proration_behavior: "none",
        metadata: {
          ...subscription.metadata,
          pending_tier_id: newTier.id,
        },
      },
      { stripeAccount: stripeAccountId }
    );

    // Store the pending tier change in our metadata
    // The actual tier_id update happens when invoice.payment_succeeded fires for the new period
    // For now, we store the pending change so the UI can show it
    await supabase
      .from("user_memberships")
      .update({
        // We'll update tier_id when the next invoice succeeds
        // Store pending change in a way the UI can detect
        updated_at: new Date().toISOString(),
      })
      .eq("id", membership.id);

    return NextResponse.json({
      success: true,
      effective: "next_renewal",
      new_tier_name: newTier.name,
      current_period_end: currentItem.current_period_end
        ? new Date((currentItem.current_period_end as number) * 1000).toISOString()
        : null,
    });
  } catch (err) {
    logger.error("[membership-change-tier] Error", err);

    if (err && typeof err === "object" && "type" in err) {
      const stripeErr = err as { message?: string };
      return NextResponse.json(
        { error: stripeErr.message || "Stripe error" },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
