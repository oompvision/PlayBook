import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { getFacilitySlug } from "@/lib/facility";
import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { logger } from "@/lib/logger";
import { validateBody } from "@/lib/validation";
import { membershipTiersSchema, TierConfig } from "@/lib/schemas/admin";

async function resolveOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select(
      "id, name, slug, bookable_window_days, membership_tiers_enabled, guest_booking_window_days, member_booking_window_days, credit_type"
    )
    .eq("slug", slug)
    .single();

  return org;
}

/**
 * GET /api/admin/membership-tiers
 * Returns all tier configs + org settings + active subscriber counts per tier.
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

    // Get all tiers for this org
    const { data: tiers } = await supabase
      .from("membership_tiers")
      .select("*")
      .eq("org_id", org.id)
      .order("sort_order", { ascending: true });

    // Count active Stripe subscribers per tier
    const { data: subscriberCounts } = await supabase
      .from("user_memberships")
      .select("tier_id")
      .eq("org_id", org.id)
      .eq("source", "stripe")
      .in("status", ["active", "past_due"]);

    const tierSubscriberCounts: Record<string, number> = {};
    for (const sub of subscriberCounts || []) {
      tierSubscriberCounts[sub.tier_id] = (tierSubscriberCounts[sub.tier_id] || 0) + 1;
    }

    // Total active Stripe subscribers
    const totalActiveSubscribers = Object.values(tierSubscriberCounts).reduce(
      (sum, c) => sum + c,
      0
    );

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
      credit_type: org.credit_type,
      tiers: tiers || [],
      tier_subscriber_counts: tierSubscriberCounts,
      active_stripe_subscriber_count: totalActiveSubscribers,
      stripe_connected:
        !!paymentSettings?.stripe_account_id &&
        !!paymentSettings?.stripe_onboarding_complete,
    });
  } catch (err) {
    logger.error("[membership-tiers] GET error", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api/admin/membership-tiers
 * Save multi-tier config. Creates/updates Stripe Products + Prices per tier.
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

    const parsed = await validateBody(request, membershipTiersSchema);
    if (parsed.error) return parsed.error;
    const { enabled, guest_booking_window_days, credit_type, tiers } = parsed.data;

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

      const guestWindow =
        org.guest_booking_window_days ?? org.bookable_window_days ?? 30;

      await supabase
        .from("organizations")
        .update({
          membership_tiers_enabled: false,
          bookable_window_days: guestWindow,
          member_booking_window_days: null,
          credit_type: null,
        })
        .eq("id", org.id);

      return NextResponse.json({ success: true });
    }

    // === Enabling / Updating ===
    if (!tiers || tiers.length === 0) {
      return NextResponse.json(
        { error: "At least one membership tier is required." },
        { status: 400 }
      );
    }

    if (tiers.length > 10) {
      return NextResponse.json(
        { error: "Maximum 10 membership tiers allowed." },
        { status: 400 }
      );
    }

    // Validate each tier has at least one price
    for (const tier of tiers) {
      if (!tier.price_monthly_cents && !tier.price_yearly_cents) {
        return NextResponse.json(
          { error: `Tier "${tier.tier_name}" must have at least one subscription price.` },
          { status: 400 }
        );
      }
    }

    // Validate sort_order uniqueness
    const sortOrders = tiers.map((t) => t.sort_order);
    if (new Set(sortOrders).size !== sortOrders.length) {
      return NextResponse.json(
        { error: "Each tier must have a unique level/order." },
        { status: 400 }
      );
    }

    // Validate credit config consistency
    if (credit_type) {
      for (const tier of tiers) {
        if (tier.credit_amount && tier.credit_amount > 0 && !tier.credit_period) {
          return NextResponse.json(
            { error: `Tier "${tier.tier_name}" has credit amount but no credit period.` },
            { status: 400 }
          );
        }
      }
    }

    const guestWindow = Math.min(
      365,
      Math.max(1, guest_booking_window_days ?? org.bookable_window_days ?? 30)
    );

    // Compute the max member booking window across all tiers
    const maxMemberWindow = Math.max(
      guestWindow,
      ...tiers.map((t) => t.bookable_window_days ?? guestWindow)
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

    // Get existing tiers for this org
    const { data: existingTiers } = await supabase
      .from("membership_tiers")
      .select("*")
      .eq("org_id", org.id);

    const existingTierMap = new Map(
      (existingTiers || []).map((t) => [t.id, t])
    );

    // Track IDs of tiers being kept
    const keptTierIds = new Set<string>();

    // Process each tier
    for (const tier of tiers) {
      const existing = tier.id ? existingTierMap.get(tier.id) : null;
      const result = await upsertTier(
        supabase,
        org.id,
        org.name,
        stripeAccountId,
        tier,
        existing
      );

      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      keptTierIds.add(result.tierId!);
    }

    // Delete tiers that are no longer in the list
    for (const [existingId, existingTier] of existingTierMap) {
      if (!keptTierIds.has(existingId)) {
        // Check if this tier has active subscribers
        const { count } = await supabase
          .from("user_memberships")
          .select("*", { count: "exact", head: true })
          .eq("tier_id", existingId)
          .eq("source", "stripe")
          .in("status", ["active", "past_due"]);

        if ((count ?? 0) > 0) {
          return NextResponse.json(
            {
              error: `Cannot remove tier "${existingTier.name}" — it has ${count} active subscriber(s).`,
            },
            { status: 400 }
          );
        }

        // Archive Stripe prices
        if (existingTier.stripe_price_monthly_id) {
          try {
            await stripe.prices.update(
              existingTier.stripe_price_monthly_id,
              { active: false },
              { stripeAccount: stripeAccountId }
            );
          } catch { /* ignore */ }
        }
        if (existingTier.stripe_price_yearly_id) {
          try {
            await stripe.prices.update(
              existingTier.stripe_price_yearly_id,
              { active: false },
              { stripeAccount: stripeAccountId }
            );
          } catch { /* ignore */ }
        }

        await supabase
          .from("membership_tiers")
          .delete()
          .eq("id", existingId);
      }
    }

    // Update organization settings
    await supabase
      .from("organizations")
      .update({
        membership_tiers_enabled: true,
        bookable_window_days: guestWindow,
        guest_booking_window_days: guestWindow,
        member_booking_window_days: maxMemberWindow,
        credit_type: credit_type || null,
      })
      .eq("id", org.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("[membership-tiers] PUT error", err);

    if (err && typeof err === "object" && "type" in err) {
      const stripeErr = err as { message?: string };
      return NextResponse.json(
        { error: stripeErr.message || "Stripe error" },
        { status: 400 }
      );
    }

    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Upsert a single tier: create/update Stripe Product + Prices, then save to DB.
 */
async function upsertTier(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  orgName: string,
  stripeAccountId: string,
  tier: TierConfig,
  existing: Record<string, unknown> | null
): Promise<{ tierId?: string; error?: string }> {
  let stripeProductId: string | null = (existing?.stripe_product_id as string) ?? null;
  let stripePriceMonthlyId: string | null = (existing?.stripe_price_monthly_id as string) ?? null;
  let stripePriceYearlyId: string | null = (existing?.stripe_price_yearly_id as string) ?? null;

  // Create Stripe Product if needed
  if (!stripeProductId) {
    const product = await stripe.products.create(
      {
        name: `${orgName} - ${tier.tier_name}`,
        metadata: { org_id: orgId },
      },
      { stripeAccount: stripeAccountId }
    );
    stripeProductId = product.id;
  } else {
    await stripe.products.update(
      stripeProductId,
      { name: `${orgName} - ${tier.tier_name}` },
      { stripeAccount: stripeAccountId }
    );
  }

  // Handle monthly price
  const existingMonthly = (existing?.price_monthly_cents as number) ?? null;
  if (tier.price_monthly_cents && tier.price_monthly_cents !== existingMonthly) {
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
        unit_amount: tier.price_monthly_cents,
        currency: "usd",
        recurring: { interval: "month" },
      },
      { stripeAccount: stripeAccountId }
    );
    stripePriceMonthlyId = monthlyPrice.id;
  } else if (!tier.price_monthly_cents && stripePriceMonthlyId) {
    await stripe.prices.update(
      stripePriceMonthlyId,
      { active: false },
      { stripeAccount: stripeAccountId }
    );
    stripePriceMonthlyId = null;
  }

  // Handle yearly price
  const existingYearly = (existing?.price_yearly_cents as number) ?? null;
  if (tier.price_yearly_cents && tier.price_yearly_cents !== existingYearly) {
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
        unit_amount: tier.price_yearly_cents,
        currency: "usd",
        recurring: { interval: "year" },
      },
      { stripeAccount: stripeAccountId }
    );
    stripePriceYearlyId = yearlyPrice.id;
  } else if (!tier.price_yearly_cents && stripePriceYearlyId) {
    await stripe.prices.update(
      stripePriceYearlyId,
      { active: false },
      { stripeAccount: stripeAccountId }
    );
    stripePriceYearlyId = null;
  }

  // Upsert tier row
  const tierData = {
    org_id: orgId,
    sort_order: tier.sort_order,
    name: tier.tier_name,
    benefit_description: tier.benefit_description || null,
    discount_type: tier.discount_type,
    discount_value: tier.discount_value,
    event_discount_type: tier.event_discount_type || "percent",
    event_discount_value: tier.event_discount_value ?? 0,
    price_monthly_cents: tier.price_monthly_cents || null,
    price_yearly_cents: tier.price_yearly_cents || null,
    bookable_window_days: tier.bookable_window_days || null,
    credit_amount: tier.credit_amount || null,
    credit_period: tier.credit_period || null,
    stripe_product_id: stripeProductId,
    stripe_price_monthly_id: stripePriceMonthlyId,
    stripe_price_yearly_id: stripePriceYearlyId,
  };

  if (existing && tier.id) {
    const { error } = await supabase
      .from("membership_tiers")
      .update(tierData)
      .eq("id", tier.id);

    if (error) {
      return { error: `Failed to update tier "${tier.tier_name}": ${error.message}` };
    }
    return { tierId: tier.id };
  } else {
    const { data, error } = await supabase
      .from("membership_tiers")
      .insert(tierData)
      .select("id")
      .single();

    if (error) {
      return { error: `Failed to create tier "${tier.tier_name}": ${error.message}` };
    }
    return { tierId: data.id };
  }
}
