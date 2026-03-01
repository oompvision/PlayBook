import { NextRequest, NextResponse } from "next/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

/**
 * POST /api/stripe/modify-booking-payment
 * Handles payment adjustments when a booking is modified and the price changes.
 *
 * For charge_upfront:
 *   - Price increase → off-session charge for the diff using saved payment method
 *   - Price decrease → partial refund on original PaymentIntent
 *   - Same price → no Stripe action, just link payment to new booking
 *
 * For hold / hold_charge_manual:
 *   - Carry over saved card info to the new booking's payment record
 *   - No immediate charge/refund needed
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      old_booking_id: string;
      new_booking_id: string;
      new_amount_cents: number;
    };

    if (!body.old_booking_id || !body.new_booking_id) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Resolve org
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
      .select("id")
      .eq("slug", slug)
      .single();

    if (!org) {
      return NextResponse.json(
        { error: "Facility not found" },
        { status: 404 }
      );
    }

    // Get payment settings
    const { data: settings } = await supabase
      .from("org_payment_settings")
      .select(
        "payment_mode, stripe_account_id, platform_fee_percent"
      )
      .eq("org_id", org.id)
      .single();

    if (!settings || settings.payment_mode === "none") {
      // No payment mode — nothing to do
      return NextResponse.json({ status: "no_payment_required" });
    }

    if (!settings.stripe_account_id) {
      return NextResponse.json(
        { error: "Payment settings not configured" },
        { status: 400 }
      );
    }

    // Find old booking's payment record
    const { data: oldPayment } = await supabase
      .from("booking_payments")
      .select("*")
      .eq("booking_id", body.old_booking_id)
      .eq("org_id", org.id)
      .single();

    if (!oldPayment) {
      // Old booking had no payment record — nothing to adjust
      return NextResponse.json({ status: "no_previous_payment" });
    }

    // Verify new booking belongs to this user
    const { data: newBooking } = await supabase
      .from("bookings")
      .select("id, customer_id, total_price_cents")
      .eq("id", body.new_booking_id)
      .single();

    if (!newBooking || newBooking.customer_id !== auth.profile.id) {
      return NextResponse.json(
        { error: "Booking not found or unauthorized" },
        { status: 403 }
      );
    }

    const stripeAccountId = settings.stripe_account_id;
    const newAmountCents = body.new_amount_cents;
    const oldAmountCents = oldPayment.amount_cents || 0;
    const diff = newAmountCents - oldAmountCents;

    if (settings.payment_mode === "charge_upfront") {
      return await handleChargeUpfrontModification({
        supabase,
        stripeAccountId,
        settings,
        oldPayment,
        newBooking,
        org,
        auth,
        diff,
        newAmountCents,
        oldAmountCents,
      });
    } else {
      // hold or hold_charge_manual — carry over saved card info
      return await handleHoldModeModification({
        supabase,
        oldPayment,
        newBooking,
        org,
        auth,
        newAmountCents,
      });
    }
  } catch (err) {
    console.error("[modify-booking-payment] error:", err);

    if (err instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { error: err.message || "Stripe error" },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function handleChargeUpfrontModification({
  supabase,
  stripeAccountId,
  settings,
  oldPayment,
  newBooking,
  org,
  auth,
  diff,
  newAmountCents,
  oldAmountCents,
}: {
  supabase: ReturnType<typeof createServiceClient>;
  stripeAccountId: string;
  settings: { platform_fee_percent: number | null };
  oldPayment: Record<string, unknown>;
  newBooking: { id: string; total_price_cents: number };
  org: { id: string };
  auth: { profile: { id: string; email: string } };
  diff: number;
  newAmountCents: number;
  oldAmountCents: number;
}) {
  let newPaymentIntentId = oldPayment.stripe_payment_intent_id as string;
  let additionalChargeIntentId: string | null = null;
  let requiresAction = false;
  let clientSecret: string | null = null;

  if (diff > 0 && oldPayment.stripe_payment_method_id) {
    // Price increase — charge the difference off-session
    const platformFeePercent = Number(settings.platform_fee_percent) || 0;
    const applicationFeeAmount =
      platformFeePercent > 0
        ? Math.round((diff * platformFeePercent) / 100)
        : undefined;

    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: diff,
          currency: "usd",
          customer: oldPayment.stripe_customer_id as string,
          payment_method: oldPayment.stripe_payment_method_id as string,
          off_session: true,
          confirm: true,
          ...(applicationFeeAmount
            ? { application_fee_amount: applicationFeeAmount }
            : {}),
          metadata: {
            org_id: org.id,
            profile_id: auth.profile.id,
            modification_of: oldPayment.booking_id as string,
            type: "modification_additional_charge",
          },
        },
        { stripeAccount: stripeAccountId }
      );

      additionalChargeIntentId = pi.id;

      if (pi.status === "requires_action") {
        // Off-session charge requires 3DS — need client-side confirmation
        requiresAction = true;
        clientSecret = pi.client_secret;
      }
    } catch (err) {
      if (
        err instanceof Stripe.errors.StripeError &&
        err.code === "authentication_required"
      ) {
        // Card requires authentication — create a standard PI for client-side confirmation
        const pi = await stripe.paymentIntents.create(
          {
            amount: diff,
            currency: "usd",
            customer: oldPayment.stripe_customer_id as string,
            payment_method: oldPayment.stripe_payment_method_id as string,
            automatic_payment_methods: { enabled: true },
            ...(applicationFeeAmount
              ? { application_fee_amount: applicationFeeAmount }
              : {}),
            metadata: {
              org_id: org.id,
              profile_id: auth.profile.id,
              modification_of: oldPayment.booking_id as string,
              type: "modification_additional_charge",
            },
          },
          { stripeAccount: stripeAccountId }
        );

        additionalChargeIntentId = pi.id;
        requiresAction = true;
        clientSecret = pi.client_secret;
      } else {
        throw err;
      }
    }
  } else if (diff < 0 && oldPayment.stripe_payment_intent_id) {
    // Price decrease — partial refund
    const refundAmount = Math.abs(diff);
    await stripe.refunds.create(
      {
        payment_intent: oldPayment.stripe_payment_intent_id as string,
        amount: refundAmount,
      },
      { stripeAccount: stripeAccountId }
    );
  }

  // Create new booking_payments row for the modified booking
  await supabase.from("booking_payments").insert({
    booking_id: newBooking.id,
    org_id: org.id,
    customer_email: auth.profile.email,
    stripe_customer_id: oldPayment.stripe_customer_id,
    stripe_payment_intent_id: additionalChargeIntentId || newPaymentIntentId,
    stripe_payment_method_id: oldPayment.stripe_payment_method_id,
    status:
      diff < 0
        ? "charged"
        : requiresAction
          ? "pending"
          : "charged",
    amount_cents: newAmountCents,
    charge_type: "upfront",
    charged_at: requiresAction ? null : new Date().toISOString(),
    cancellation_policy_text: oldPayment.cancellation_policy_text,
    policy_agreed_at: oldPayment.policy_agreed_at,
  });

  return NextResponse.json({
    status: requiresAction ? "requires_action" : "success",
    diff_cents: diff,
    refunded_cents: diff < 0 ? Math.abs(diff) : 0,
    additional_charge_cents: diff > 0 ? diff : 0,
    ...(requiresAction
      ? {
          client_secret: clientSecret,
          intent_id: additionalChargeIntentId,
          stripe_account_id: stripeAccountId,
        }
      : {}),
  });
}

async function handleHoldModeModification({
  supabase,
  oldPayment,
  newBooking,
  org,
  auth,
  newAmountCents,
}: {
  supabase: ReturnType<typeof createServiceClient>;
  oldPayment: Record<string, unknown>;
  newBooking: { id: string; total_price_cents: number };
  org: { id: string };
  auth: { profile: { id: string; email: string } };
  newAmountCents: number;
}) {
  // Carry over saved card info to new booking
  await supabase.from("booking_payments").insert({
    booking_id: newBooking.id,
    org_id: org.id,
    customer_email: auth.profile.email,
    stripe_customer_id: oldPayment.stripe_customer_id,
    stripe_setup_intent_id: oldPayment.stripe_setup_intent_id,
    stripe_payment_method_id: oldPayment.stripe_payment_method_id,
    status: "card_saved",
    amount_cents: null, // No charge yet
    cancellation_policy_text: oldPayment.cancellation_policy_text,
    policy_agreed_at: oldPayment.policy_agreed_at,
  });

  return NextResponse.json({
    status: "success",
    card_carried_over: true,
    new_booking_amount_cents: newAmountCents,
  });
}
