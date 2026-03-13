import { NextRequest, NextResponse } from "next/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

/**
 * POST /api/stripe/create-checkout-intent-dynamic
 * Creates a PaymentIntent (charge_upfront) or SetupIntent (hold modes)
 * for dynamic booking. Unlike the slot-based version, this accepts
 * a price_cents amount directly (computed by the availability engine).
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Auth — customer must be logged in
    const auth = await getAuthUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { price_cents, location_id, discount_cents: rawDiscount } = (await request.json()) as {
      price_cents: number;
      location_id?: string | null;
      discount_cents?: number;
    };

    if (!price_cents || price_cents <= 0) {
      return NextResponse.json(
        { error: "Valid price_cents is required" },
        { status: 400 }
      );
    }

    // Apply membership discount (clamped to not exceed price)
    const discountCents = Math.max(0, Math.min(rawDiscount || 0, price_cents));
    const chargeAmount = price_cents - discountCents;

    if (chargeAmount <= 0) {
      return NextResponse.json({ payment_required: false, amount_cents: 0 });
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

    // 4. Find or create Stripe Customer on connected account
    let stripeCustomerId: string = "";

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

    // 5. Build cancellation policy text
    const cancellationPolicyText =
      settings.cancellation_policy_text ||
      buildCancellationPolicyText(settings);

    // 6. Create a Customer Session so PaymentElement shows saved cards
    const stripeAccountId = settings.stripe_account_id;

    let customerSessionClientSecret: string | undefined;
    try {
      const customerSession = await stripe.customerSessions.create(
        {
          customer: stripeCustomerId,
          components: {
            payment_element: {
              enabled: true,
              features: {
                payment_method_save: "enabled",
                payment_method_redisplay: "enabled",
                payment_method_redisplay_limit: 3,
              },
            },
          },
        },
        { stripeAccount: stripeAccountId }
      );
      customerSessionClientSecret = customerSession.client_secret;
    } catch (csErr) {
      // Non-fatal — fall back to no saved cards
      console.warn("[create-checkout-intent-dynamic] CustomerSession creation failed:", csErr);
    }

    // 7. Create intent based on payment mode
    if (settings.payment_mode === "charge_upfront") {
      const platformFeePercent = Number(settings.platform_fee_percent) || 0;
      const applicationFeeAmount =
        platformFeePercent > 0
          ? Math.round((chargeAmount * platformFeePercent) / 100)
          : undefined;

      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: chargeAmount,
          currency: "usd",
          customer: stripeCustomerId,
          automatic_payment_methods: { enabled: true },
          setup_future_usage: "off_session",
          ...(applicationFeeAmount
            ? { application_fee_amount: applicationFeeAmount }
            : {}),
          metadata: {
            org_id: org.id,
            profile_id: auth.profile.id,
            booking_type: "dynamic",
            original_price_cents: String(price_cents),
            discount_cents: String(discountCents),
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
        amount_cents: chargeAmount,
        original_price_cents: price_cents,
        discount_cents: discountCents,
        cancellation_policy_text: cancellationPolicyText,
        ...(customerSessionClientSecret
          ? { customer_session_client_secret: customerSessionClientSecret }
          : {}),
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
            amount_cents: String(chargeAmount),
            original_price_cents: String(price_cents),
            discount_cents: String(discountCents),
            booking_type: "dynamic",
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
        amount_cents: chargeAmount,
        original_price_cents: price_cents,
        discount_cents: discountCents,
        cancellation_policy_text: cancellationPolicyText,
        ...(customerSessionClientSecret
          ? { customer_session_client_secret: customerSessionClientSecret }
          : {}),
      });
    }
  } catch (err: unknown) {
    console.error("[create-checkout-intent-dynamic] error:", err);

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

  return `Your card is saved on file to secure your booking. Cancellations made more than ${windowHours} hours before the scheduled booking time will not be charged. Cancellations made within ${windowHours} hours of the booking start time may result in a charge of the full booking amount.`;
}
