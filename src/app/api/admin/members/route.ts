import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/members
 *
 * Grant admin membership to a customer.
 * Body: { org_id, user_id }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { org_id, user_id } = body;

  if (!org_id || !user_id) {
    return NextResponse.json(
      { error: "org_id and user_id are required" },
      { status: 400 }
    );
  }

  await requireAdmin(org_id);

  const supabase = createServiceClient();

  // Get the membership tier for this org
  const { data: tier } = await supabase
    .from("membership_tiers")
    .select("id")
    .eq("org_id", org_id)
    .single();

  if (!tier) {
    return NextResponse.json(
      { error: "No membership tier configured for this organization" },
      { status: 400 }
    );
  }

  // Check if user already has a membership
  const { data: existing } = await supabase
    .from("user_memberships")
    .select("id, status")
    .eq("org_id", org_id)
    .eq("user_id", user_id)
    .single();

  if (existing && (existing.status === "active" || existing.status === "admin_granted")) {
    return NextResponse.json(
      { error: "User already has an active membership" },
      { status: 409 }
    );
  }

  // If there's a cancelled/expired membership, update it; otherwise insert
  if (existing) {
    const { error } = await supabase
      .from("user_memberships")
      .update({
        status: "admin_granted",
        source: "admin",
        tier_id: tier.id,
        expires_at: null,
        cancelled_at: null,
        stripe_subscription_id: null,
        stripe_customer_id: null,
        current_period_end: null,
      })
      .eq("id", existing.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await supabase.from("user_memberships").insert({
      org_id,
      user_id,
      tier_id: tier.id,
      status: "admin_granted",
      source: "admin",
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/admin/members
 *
 * Revoke a membership. For Stripe memberships, also cancels the Stripe subscription.
 * Body: { membership_id, org_id }
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { membership_id, org_id } = body;

  if (!membership_id || !org_id) {
    return NextResponse.json(
      { error: "membership_id and org_id are required" },
      { status: 400 }
    );
  }

  await requireAdmin(org_id);

  const supabase = createServiceClient();

  // Fetch membership details
  const { data: membership } = await supabase
    .from("user_memberships")
    .select("id, source, stripe_subscription_id, status")
    .eq("id", membership_id)
    .eq("org_id", org_id)
    .single();

  if (!membership) {
    return NextResponse.json(
      { error: "Membership not found" },
      { status: 404 }
    );
  }

  // If Stripe subscription exists, cancel it
  if (membership.stripe_subscription_id) {
    try {
      // Get the org's connected Stripe account
      const { data: paymentSettings } = await supabase
        .from("org_payment_settings")
        .select("stripe_account_id")
        .eq("org_id", org_id)
        .single();

      const stripe = getStripe();
      await stripe.subscriptions.cancel(membership.stripe_subscription_id, {
        ...(paymentSettings?.stripe_account_id
          ? { stripeAccount: paymentSettings.stripe_account_id }
          : {}),
      });
    } catch (stripeError) {
      console.error("Failed to cancel Stripe subscription:", stripeError);
      // Continue with local revocation even if Stripe cancel fails
      // The webhook will eventually reconcile
    }
  }

  // Delete the membership record
  const { error } = await supabase
    .from("user_memberships")
    .delete()
    .eq("id", membership_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
