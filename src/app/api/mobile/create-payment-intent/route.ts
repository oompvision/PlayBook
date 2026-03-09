import { NextRequest, NextResponse } from "next/server";
import { getMobileAuth } from "@/lib/mobile-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

/**
 * POST /api/mobile/create-payment-intent
 *
 * Mobile-specific endpoint that accepts org_id in the body
 * and authenticates via Bearer token (Supabase JWT).
 *
 * Supports three booking types:
 *   - slot_booking: validates slot_ids, sums price_cents
 *   - dynamic_booking: uses provided price_cents
 *   - event: uses provided event_id to look up price, requires registration_id
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getMobileAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      org_id: string;
      type: "slot_booking" | "dynamic_booking" | "event";
      slot_ids?: string[];
      price_cents?: number;
      event_id?: string;
      registration_id?: string;
      location_id?: string | null;
    };

    if (!body.org_id || !body.type) {
      return NextResponse.json(
        { error: "org_id and type are required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Resolve org
    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, slug")
      .eq("id", body.org_id)
      .single();

    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // Resolve location name
    let locationName: string | null = null;
    if (body.location_id) {
      const { data: loc } = await supabase
        .from("locations")
        .select("name")
        .eq("id", body.location_id)
        .single();
      locationName = loc?.name ?? null;
    }

    // Get payment settings
    const { data: settings } = await supabase
      .from("org_payment_settings")
      .select(
        "payment_mode, stripe_account_id, stripe_onboarding_complete, platform_fee_percent, cancellation_window_hours, no_show_fee_cents, no_show_fee_type, cancellation_policy_text"
      )
      .eq("org_id", org.id)
      .single();

    if (!settings || settings.payment_mode === "none") {
      return NextResponse.json({ payment_required: false });
    }

    if (!settings.stripe_account_id || !settings.stripe_onboarding_complete) {
      return NextResponse.json({ payment_required: false });
    }

    // Calculate total based on type
    let totalCents = 0;
    const metadata: Record<string, string> = {
      org_id: org.id,
      profile_id: auth.profile.id,
      source: "mobile",
    };

    if (body.type === "slot_booking") {
      if (!body.slot_ids || body.slot_ids.length === 0) {
        return NextResponse.json(
          { error: "slot_ids is required for slot_booking" },
          { status: 400 }
        );
      }

      const { data: slots, error: slotsError } = await supabase
        .from("bay_schedule_slots")
        .select("id, price_cents, status")
        .in("id", body.slot_ids);

      if (slotsError || !slots || slots.length !== body.slot_ids.length) {
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

      totalCents = slots.reduce((sum, s) => sum + (s.price_cents || 0), 0);
      metadata.slot_ids = JSON.stringify(body.slot_ids);
    } else if (body.type === "dynamic_booking") {
      if (!body.price_cents || body.price_cents <= 0) {
        return NextResponse.json(
          { error: "Valid price_cents is required for dynamic_booking" },
          { status: 400 }
        );
      }
      totalCents = body.price_cents;
      metadata.booking_type = "dynamic";
    } else if (body.type === "event") {
      if (!body.event_id) {
        return NextResponse.json(
          { error: "event_id is required for event type" },
          { status: 400 }
        );
      }

      const { data: event } = await supabase
        .from("events")
        .select("id, price_cents, name, org_id")
        .eq("id", body.event_id)
        .single();

      if (!event || event.org_id !== org.id) {
        return NextResponse.json(
          { error: "Event not found" },
          { status: 404 }
        );
      }

      totalCents = event.price_cents || 0;
      metadata.event_id = body.event_id;
      metadata.type = "event_registration";

      if (body.registration_id) {
        // Verify registration exists and belongs to user
        const { data: reg } = await supabase
          .from("event_registrations")
          .select("id, user_id, status")
          .eq("id", body.registration_id)
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

        metadata.registration_id = body.registration_id;
      }
    }

    // If total is $0, no payment needed
    if (totalCents === 0) {
      return NextResponse.json({ payment_required: false });
    }

    if (body.location_id) metadata.location_id = body.location_id;
    if (locationName) metadata.location_name = locationName;

    // Find or create Stripe Customer on connected account
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

    // Create ephemeral key for the customer on the connected account
    // Required for PaymentSheet to authenticate against the connected account
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: stripeCustomerId },
      {
        stripeAccount: settings.stripe_account_id,
        apiVersion: "2026-02-25.clover",
      }
    );

    // Build cancellation policy text
    const cancellationPolicyText =
      settings.cancellation_policy_text ||
      buildCancellationPolicyText(settings);

    // Create intent based on payment mode
    const stripeAccountId = settings.stripe_account_id;
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!;

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
          payment_method_types: ['card'],
          ...(applicationFeeAmount
            ? { application_fee_amount: applicationFeeAmount }
            : {}),
          metadata,
          ...(locationName
            ? { statement_descriptor_suffix: locationName.slice(0, 22) }
            : {}),
        },
        { stripeAccount: stripeAccountId }
      );

      return NextResponse.json({
        payment_required: true,
        client_secret: paymentIntent.client_secret,
        intent_type: "payment",
        intent_id: paymentIntent.id,
        stripe_customer_id: stripeCustomerId,
        stripe_account_id: stripeAccountId,
        ephemeral_key_secret: ephemeralKey.secret,
        publishable_key: publishableKey,
        amount_cents: totalCents,
        cancellation_policy_text: cancellationPolicyText,
      });
    } else {
      // hold or hold_charge_manual → SetupIntent
      metadata.amount_cents = String(totalCents);

      const setupIntent = await stripe.setupIntents.create(
        {
          customer: stripeCustomerId,
          payment_method_types: ['card'],
          metadata,
        },
        { stripeAccount: stripeAccountId }
      );

      return NextResponse.json({
        payment_required: true,
        client_secret: setupIntent.client_secret,
        intent_type: "setup",
        intent_id: setupIntent.id,
        stripe_customer_id: stripeCustomerId,
        stripe_account_id: stripeAccountId,
        ephemeral_key_secret: ephemeralKey.secret,
        publishable_key: publishableKey,
        amount_cents: totalCents,
        cancellation_policy_text: cancellationPolicyText,
      });
    }
  } catch (err) {
    console.error("[mobile/create-payment-intent] error:", err);

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
    return `Cancellations made more than ${windowHours} hours before the scheduled time will receive a full refund. No refunds within ${windowHours} hours. Full payment is collected at time of booking.`;
  }

  return `Your card is saved on file to secure your booking. Cancellations more than ${windowHours} hours before will not be charged. Cancellations within ${windowHours} hours may result in a charge of the full amount.`;
}
