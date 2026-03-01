import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAdminAuth } from "@/lib/auth";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";

/**
 * Resolve the current org from the facility slug header.
 */
async function resolveOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, slug, name")
    .eq("slug", slug)
    .single();

  return org;
}

/**
 * GET /api/stripe/connect
 * Check the Stripe Connect onboarding status for the current org.
 */
export async function GET(_request: NextRequest) {
  try {
    const org = await resolveOrg();
    if (!org) {
      return NextResponse.json(
        { error: "Facility not found" },
        { status: 404 }
      );
    }

    const auth = await getAdminAuth(org.id);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createClient();
    const { data: settings } = await supabase
      .from("org_payment_settings")
      .select("stripe_account_id, stripe_onboarding_complete")
      .eq("org_id", org.id)
      .single();

    if (!settings?.stripe_account_id) {
      return NextResponse.json({ status: "not_started" });
    }

    // Retrieve the account from Stripe to check current status
    const account = await stripe.accounts.retrieve(settings.stripe_account_id);

    const isComplete =
      account.charges_enabled && account.details_submitted;

    // Sync onboarding status to our DB
    if (isComplete !== settings.stripe_onboarding_complete) {
      await supabase
        .from("org_payment_settings")
        .update({ stripe_onboarding_complete: isComplete })
        .eq("org_id", org.id);
    }

    return NextResponse.json({
      status: isComplete ? "complete" : "incomplete",
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      requirements: isComplete ? undefined : account.requirements,
    });
  } catch (err) {
    console.error("[stripe/connect] GET error:", err);

    if (err instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { error: err.message || "Stripe configuration error" },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * POST /api/stripe/connect
 * Create a Stripe Connect account (if needed) and return an onboarding link.
 */
export async function POST(request: NextRequest) {
  try {
    const org = await resolveOrg();
    if (!org) {
      return NextResponse.json(
        { error: "Facility not found" },
        { status: 404 }
      );
    }

    const auth = await getAdminAuth(org.id);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createClient();

    // Get existing payment settings
    let { data: settings } = await supabase
      .from("org_payment_settings")
      .select("stripe_account_id")
      .eq("org_id", org.id)
      .single();

    let stripeAccountId = settings?.stripe_account_id;

    // Create a Standard Connect account if one doesn't exist
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "standard",
        metadata: {
          org_id: org.id,
          org_slug: org.slug,
        },
      });

      stripeAccountId = account.id;

      // Save the account ID to our DB
      await supabase
        .from("org_payment_settings")
        .update({ stripe_account_id: stripeAccountId })
        .eq("org_id", org.id);
    }

    // Build the return/refresh URLs
    const origin = request.headers.get("origin") || request.nextUrl.origin;
    const returnUrl = `${origin}/admin/settings?stripe=complete`;
    const refreshUrl = `${origin}/admin/settings?stripe=refresh`;

    // Generate an Account Link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      type: "account_onboarding",
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (err) {
    console.error("[stripe/connect] POST error:", err);

    // Surface Stripe API errors to the admin
    if (err instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { error: err.message || "Stripe configuration error" },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
