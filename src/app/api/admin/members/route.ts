import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { validateBody } from "@/lib/validation";
import { grantMembershipSchema, revokeMembershipSchema } from "@/lib/schemas/admin";

/**
 * POST /api/admin/members
 *
 * Grant admin membership to a customer.
 * Body: { org_id, user_id }
 */
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, grantMembershipSchema);
  if (parsed.error) return parsed.error;
  const { org_id, user_id } = parsed.data;

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
      logger.error("[admin/members] update membership error", { message: error.message });
      return NextResponse.json({ error: "Failed to grant membership" }, { status: 500 });
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
      logger.error("[admin/members] insert membership error", { message: error.message });
      return NextResponse.json({ error: "Failed to grant membership" }, { status: 500 });
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
  const parsed = await validateBody(request, revokeMembershipSchema);
  if (parsed.error) return parsed.error;
  const { membership_id, org_id } = parsed.data;

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
      logger.error("Failed to cancel Stripe subscription", stripeError);
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
    logger.error("[admin/members] delete membership error", { message: error.message });
    return NextResponse.json({ error: "Failed to revoke membership" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
