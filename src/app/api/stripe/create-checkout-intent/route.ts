import { NextRequest, NextResponse } from "next/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

/**
 * POST /api/stripe/create-checkout-intent
 * Creates a PaymentIntent (charge_upfront) or SetupIntent (hold modes)
 * on the org's connected Stripe account.
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Auth — customer must be logged in
    const auth = await getAuthUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slot_ids, location_id } = (await request.json()) as {
      slot_ids: string[];
      location_id?: string | null;
    };

    if (!slot_ids || slot_ids.length === 0) {
      return NextResponse.json(
        { error: "slot_ids is required" },
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
      .select("id, name, slug")
      .eq("slug", slug)
      .single();

    if (!org) {
      return NextResponse.json(
        { error: "Facility not found" },
        { status: 404 }
      );
    }

    // 2b. Resolve location name (if provided)
    let locationName: string | null = null;
    if (location_id) {
      const { data: loc } = await supabase
        .from("locations")
        .select("name")
        .eq("id", location_id)
        .single();
      locationName = loc?.name ?? null;
    }

    // 3. Get payment settings
    const { data: settings } = await supabase
      .from("org_payment_settings")
      .select(
        "payment_mode, stripe_account_id, stripe_onboarding_complete, platform_fee_percent, cancellation_window_hours, no_show_fee_cents, no_show_fee_type, cancellation_policy_text"
      )
      .eq("org_id", org.id)
      .single();

    if (!settings || settings.payment_mode === "none") {
      return NextResponse.json(
        { error: "Payment not required for this facility" },
        { status: 400 }
      );
    }

    if (!settings.stripe_account_id || !settings.stripe_onboarding_complete) {
      return NextResponse.json(
        { error: "Facility payment setup is incomplete" },
        { status: 400 }
      );
    }

    // 4. Fetch and validate slot prices
    const { data: slots, error: slotsError } = await supabase
      .from("bay_schedule_slots")
      .select("id, price_cents, status")
      .in("id", slot_ids);

    if (slotsError || !slots || slots.length !== slot_ids.length) {
      return NextResponse.json(
        { error: "One or more slots not found" },
        { status: 400 }
      );
    }

    const unavailable = slots.filter((s) => s.status !== "available");
    if (unavailable.length > 0) {
      return NextResponse.json(
        { error: "One or more slots are no longer available" },
        { status: 409 }
      );
    }

    const totalCents = slots.reduce((sum, s) => sum + (s.price_cents || 0), 0);

    // 5. Find or create Stripe Customer on connected account
    let stripeCustomerId: string = "";

    // Look up existing customer for this user+org
    const { data: existingPayment } = await supabase
      .from("booking_payments")
      .select("stripe_customer_id")
      .eq("org_id", org.id)
      .eq("customer_email", auth.profile.email)
      .not("stripe_customer_id", "is", null)
      .limit(1)
      .single();

    if (existingPayment?.stripe_customer_id) {
      stripeCustomerId = existingPayment.stripe_customer_id as string;
    } else {
      // Create new customer on the connected account
      const customer = await stripe.customers.create(
        {
          email: auth.profile.email,
          name: auth.profile.full_name || undefined,
          metadata: {
            profile_id: auth.profile.id,
            org_id: org.id,
          },
        },
        { stripeAccount: settings.stripe_account_id }
      );
      stripeCustomerId = customer.id;
    }

    // 6. Build cancellation policy text (use custom text if admin has set one)
    const cancellationPolicyText =
      settings.cancellation_policy_text || buildCancellationPolicyText(settings);

    // 7. Create intent based on payment mode
    const stripeAccountId = settings.stripe_account_id;

    if (settings.payment_mode === "charge_upfront") {
      // Calculate platform fee
      const platformFeePercent = Number(settings.platform_fee_percent) || 0;
      const applicationFeeAmount =
        platformFeePercent > 0
          ? Math.round((totalCents * platformFeePercent) / 100)
          : undefined;

      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: totalCents,
          currency: "usd",
          customer: stripeCustomerId,
          automatic_payment_methods: { enabled: true },
          ...(applicationFeeAmount
            ? { application_fee_amount: applicationFeeAmount }
            : {}),
          metadata: {
            org_id: org.id,
            profile_id: auth.profile.id,
            slot_ids: JSON.stringify(slot_ids),
            ...(location_id ? { location_id } : {}),
            ...(locationName ? { location_name: locationName } : {}),
          },
          ...(locationName
            ? { statement_descriptor_suffix: locationName.slice(0, 22) }
            : {}),
        },
        { stripeAccount: stripeAccountId }
      );

      return NextResponse.json({
        client_secret: paymentIntent.client_secret,
        intent_type: "payment",
        intent_id: paymentIntent.id,
        stripe_customer_id: stripeCustomerId,
        stripe_account_id: stripeAccountId,
        amount_cents: totalCents,
        cancellation_policy_text: cancellationPolicyText,
      });
    } else {
      // hold or hold_charge_manual → SetupIntent
      const setupIntent = await stripe.setupIntents.create(
        {
          customer: stripeCustomerId,
          automatic_payment_methods: { enabled: true },
          metadata: {
            org_id: org.id,
            profile_id: auth.profile.id,
            slot_ids: JSON.stringify(slot_ids),
            amount_cents: String(totalCents),
            ...(location_id ? { location_id } : {}),
            ...(locationName ? { location_name: locationName } : {}),
          },
        },
        { stripeAccount: stripeAccountId }
      );

      return NextResponse.json({
        client_secret: setupIntent.client_secret,
        intent_type: "setup",
        intent_id: setupIntent.id,
        stripe_customer_id: stripeCustomerId,
        stripe_account_id: stripeAccountId,
        amount_cents: totalCents,
        cancellation_policy_text: cancellationPolicyText,
      });
    }
  } catch (err) {
    console.error("[create-checkout-intent] error:", err);

    if (err instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { error: err.message || "Stripe error" },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function buildCancellationPolicyText(settings: {
  cancellation_window_hours: number;
  no_show_fee_cents: number | null;
  no_show_fee_type: string;
  payment_mode: string;
}): string {
  const windowHours = settings.cancellation_window_hours;

  if (settings.payment_mode === "charge_upfront") {
    return `Cancellations made more than ${windowHours} hours before the scheduled booking time will receive a full refund. No refunds will be issued for cancellations made within ${windowHours} hours of the booking start time. Full payment is collected at the time of booking.`;
  }

  // hold / hold_charge_manual
  return `Your card is saved on file to secure your booking. Cancellations made more than ${windowHours} hours before the scheduled booking time will not be charged. Cancellations made within ${windowHours} hours of the booking start time may result in a charge of the full booking amount.`;
}
