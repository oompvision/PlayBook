import { NextRequest, NextResponse } from "next/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

/**
 * POST /api/stripe/create-event-checkout-intent
 * Creates a PaymentIntent (charge_upfront) or SetupIntent (hold modes)
 * on the org's connected Stripe account for an event registration.
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Auth — customer must be logged in
    const auth = await getAuthUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { event_id, registration_id } = (await request.json()) as {
      event_id: string;
      registration_id: string;
    };

    if (!event_id || !registration_id) {
      return NextResponse.json(
        { error: "event_id and registration_id are required" },
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

    // 4. Fetch event to get price
    const { data: event } = await supabase
      .from("events")
      .select("id, price_cents, name, org_id")
      .eq("id", event_id)
      .single();

    if (!event) {
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 }
      );
    }

    if (event.org_id !== org.id) {
      return NextResponse.json(
        { error: "Event does not belong to this facility" },
        { status: 403 }
      );
    }

    const totalCents = event.price_cents || 0;

    if (totalCents === 0) {
      return NextResponse.json(
        { error: "Event is free — no payment intent needed" },
        { status: 400 }
      );
    }

    // 5. Verify registration exists and belongs to user
    const { data: reg } = await supabase
      .from("event_registrations")
      .select("id, user_id, status")
      .eq("id", registration_id)
      .single();

    if (!reg || reg.user_id !== auth.user.id) {
      return NextResponse.json(
        { error: "Registration not found" },
        { status: 404 }
      );
    }

    if (reg.status !== "pending_payment") {
      return NextResponse.json(
        { error: "Registration is not pending payment" },
        { status: 400 }
      );
    }

    // 6. Find or create Stripe Customer on connected account
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

    // 7. Build cancellation policy text
    const cancellationPolicyText =
      settings.cancellation_policy_text ||
      buildCancellationPolicyText(settings);

    // 8. Create intent based on payment mode
    const stripeAccountId = settings.stripe_account_id;

    if (settings.payment_mode === "charge_upfront") {
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
            event_id,
            registration_id,
            type: "event_registration",
          },
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
            event_id,
            registration_id,
            amount_cents: String(totalCents),
            type: "event_registration",
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
    console.error("[create-event-checkout-intent] error:", err);

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
    return `Cancellations made more than ${windowHours} hours before the event start time will receive a full refund. No refunds will be issued for cancellations made within ${windowHours} hours. Full payment is collected at the time of registration.`;
  }

  return `Your card is saved on file to secure your registration. Cancellations made more than ${windowHours} hours before the event start time will not be charged. Cancellations made within ${windowHours} hours may result in a charge of the full registration amount.`;
}
