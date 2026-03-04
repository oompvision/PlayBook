import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { getFacilitySlug } from "@/lib/facility";
import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

async function resolveOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select(
      "id, name, slug, bookable_window_days, membership_tiers_enabled, guest_booking_window_days, member_booking_window_days"
    )
    .eq("slug", slug)
    .single();

  return org;
}

/**
 * GET /api/admin/membership-tier
 * Returns current tier config + active subscriber count.
 */
export async function GET() {
  try {
    const org = await resolveOrg();
    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    await requireAdmin(org.id);

    const supabase = await createClient();

    // Get tier config
    const { data: tier } = await supabase
      .from("membership_tiers")
      .select("*")
      .eq("org_id", org.id)
      .single();

    // Count active Stripe subscribers (not admin-granted)
    const { count } = await supabase
      .from("user_memberships")
      .select("*", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("source", "stripe")
      .in("status", ["active", "past_due"]);

    // Get Stripe Connect status
    const { data: paymentSettings } = await supabase
      .from("org_payment_settings")
      .select("stripe_account_id, stripe_onboarding_complete")
      .eq("org_id", org.id)
      .single();

    return NextResponse.json({
      enabled: org.membership_tiers_enabled,
      bookable_window_days: org.bookable_window_days,
      guest_booking_window_days: org.guest_booking_window_days,
      member_booking_window_days: org.member_booking_window_days,
      tier,
      active_stripe_subscriber_count: count ?? 0,
      stripe_connected:
        !!paymentSettings?.stripe_account_id &&
        !!paymentSettings?.stripe_onboarding_complete,
    });
  } catch (err) {
    console.error("[membership-tier] GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/membership-tier
 * Save tier config. Creates/updates Stripe Product + Prices on connected account.
 */
export async function PUT(request: NextRequest) {
  try {
    const org = await resolveOrg();
    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    await requireAdmin(org.id);

    const body = await request.json();
    const {
      enabled,
      tier_name,
      benefit_description,
      discount_type,
      discount_value,
      price_monthly_cents,
      price_yearly_cents,
      guest_booking_window_days,
      member_booking_window_days,
    } = body;

    const supabase = await createClient();

    // === Disabling ===
    if (!enabled) {
      // Check for active Stripe subscribers
      const { count } = await supabase
        .from("user_memberships")
        .select("*", { count: "exact", head: true })
        .eq("org_id", org.id)
        .eq("source", "stripe")
        .in("status", ["active", "past_due"]);

      if ((count ?? 0) > 0) {
        return NextResponse.json(
          {
            error:
              "Cannot disable Membership Tiers while active Stripe subscribers exist.",
          },
          { status: 400 }
        );
      }

      // Sync bookable_window_days back from guest value, null out member
      const guestWindow =
        org.guest_booking_window_days ?? org.bookable_window_days ?? 30;

      await supabase
        .from("organizations")
        .update({
          membership_tiers_enabled: false,
          bookable_window_days: guestWindow,
          member_booking_window_days: null,
        })
        .eq("id", org.id);

      return NextResponse.json({ success: true });
    }

    // === Enabling / Updating ===

    // Validate
    if (!price_monthly_cents && !price_yearly_cents) {
      return NextResponse.json(
        { error: "At least one subscription price is required." },
        { status: 400 }
      );
    }

    if (!["flat", "percent"].includes(discount_type)) {
      return NextResponse.json(
        { error: "Invalid discount type." },
        { status: 400 }
      );
    }

    if (typeof discount_value !== "number" || discount_value < 0) {
      return NextResponse.json(
        { error: "Discount value must be a non-negative number." },
        { status: 400 }
      );
    }

    if (discount_type === "percent" && discount_value > 100) {
      return NextResponse.json(
        { error: "Percentage discount cannot exceed 100%." },
        { status: 400 }
      );
    }

    const guestWindow = Math.min(
      365,
      Math.max(1, guest_booking_window_days ?? org.bookable_window_days ?? 30)
    );
    const memberWindow = Math.min(
      365,
      Math.max(guestWindow, member_booking_window_days ?? guestWindow)
    );

    // Get Stripe Connect account
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
        {
          error:
            "Stripe Connect must be set up before enabling Membership Tiers.",
        },
        { status: 400 }
      );
    }

    const stripeAccountId = paymentSettings.stripe_account_id;

    // Check for existing tier
    const { data: existingTier } = await supabase
      .from("membership_tiers")
      .select("id, stripe_product_id, stripe_price_monthly_id, stripe_price_yearly_id, price_monthly_cents, price_yearly_cents")
      .eq("org_id", org.id)
      .single();

    let stripeProductId = existingTier?.stripe_product_id ?? null;
    let stripePriceMonthlyId = existingTier?.stripe_price_monthly_id ?? null;
    let stripePriceYearlyId = existingTier?.stripe_price_yearly_id ?? null;

    // Create Stripe Product if it doesn't exist
    if (!stripeProductId) {
      const product = await stripe.products.create(
        {
          name: `${org.name} - ${tier_name || "Membership"}`,
          metadata: { org_id: org.id },
        },
        { stripeAccount: stripeAccountId }
      );
      stripeProductId = product.id;
    } else {
      // Update product name if it changed
      await stripe.products.update(
        stripeProductId,
        { name: `${org.name} - ${tier_name || "Membership"}` },
        { stripeAccount: stripeAccountId }
      );
    }

    // Create/update monthly price if needed
    if (
      price_monthly_cents &&
      price_monthly_cents !== existingTier?.price_monthly_cents
    ) {
      // Archive old price if it exists
      if (stripePriceMonthlyId) {
        await stripe.prices.update(
          stripePriceMonthlyId,
          { active: false },
          { stripeAccount: stripeAccountId }
        );
      }
      const monthlyPrice = await stripe.prices.create(
        {
          product: stripeProductId,
          unit_amount: price_monthly_cents,
          currency: "usd",
          recurring: { interval: "month" },
        },
        { stripeAccount: stripeAccountId }
      );
      stripePriceMonthlyId = monthlyPrice.id;
    } else if (!price_monthly_cents && stripePriceMonthlyId) {
      // Archive removed monthly price
      await stripe.prices.update(
        stripePriceMonthlyId,
        { active: false },
        { stripeAccount: stripeAccountId }
      );
      stripePriceMonthlyId = null;
    }

    // Create/update yearly price if needed
    if (
      price_yearly_cents &&
      price_yearly_cents !== existingTier?.price_yearly_cents
    ) {
      if (stripePriceYearlyId) {
        await stripe.prices.update(
          stripePriceYearlyId,
          { active: false },
          { stripeAccount: stripeAccountId }
        );
      }
      const yearlyPrice = await stripe.prices.create(
        {
          product: stripeProductId,
          unit_amount: price_yearly_cents,
          currency: "usd",
          recurring: { interval: "year" },
        },
        { stripeAccount: stripeAccountId }
      );
      stripePriceYearlyId = yearlyPrice.id;
    } else if (!price_yearly_cents && stripePriceYearlyId) {
      await stripe.prices.update(
        stripePriceYearlyId,
        { active: false },
        { stripeAccount: stripeAccountId }
      );
      stripePriceYearlyId = null;
    }

    // Upsert membership_tiers row
    const tierData = {
      org_id: org.id,
      name: tier_name || "Membership",
      benefit_description: benefit_description || null,
      discount_type,
      discount_value,
      price_monthly_cents: price_monthly_cents || null,
      price_yearly_cents: price_yearly_cents || null,
      stripe_product_id: stripeProductId,
      stripe_price_monthly_id: stripePriceMonthlyId,
      stripe_price_yearly_id: stripePriceYearlyId,
    };

    if (existingTier) {
      await supabase
        .from("membership_tiers")
        .update(tierData)
        .eq("id", existingTier.id);
    } else {
      await supabase.from("membership_tiers").insert(tierData);
    }

    // Update organizations
    await supabase
      .from("organizations")
      .update({
        membership_tiers_enabled: true,
        bookable_window_days: guestWindow,
        guest_booking_window_days: guestWindow,
        member_booking_window_days: memberWindow,
      })
      .eq("id", org.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[membership-tier] PUT error:", err);

    // Surface Stripe errors clearly
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
