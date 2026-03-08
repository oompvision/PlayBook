import { NextRequest, NextResponse } from "next/server";
import { getMobileAuth } from "@/lib/mobile-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

/**
 * POST /api/mobile/record-booking-payment
 *
 * Mobile-specific endpoint. Records a booking_payments row after
 * a successful booking + payment. Uses org_id from body and
 * Bearer token auth instead of slug/cookie auth.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getMobileAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      org_id: string;
      booking_id?: string;
      event_registration_id?: string;
      intent_id: string;
      intent_type: "payment" | "setup";
      stripe_customer_id: string;
      stripe_payment_method_id?: string;
      amount_cents: number;
      cancellation_policy_text?: string;
      policy_agreed_at?: string;
    };

    if (!body.org_id || !body.intent_id || !body.intent_type) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!body.booking_id && !body.event_registration_id) {
      return NextResponse.json(
        { error: "Either booking_id or event_registration_id is required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Verify org exists
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("id", body.org_id)
      .single();

    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // Verify booking belongs to this user (if booking_id provided)
    if (body.booking_id) {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, customer_id, org_id")
        .eq("id", body.booking_id)
        .single();

      if (!booking) {
        return NextResponse.json(
          { error: "Booking not found" },
          { status: 404 }
        );
      }

      if (booking.customer_id !== auth.profile.id) {
        return NextResponse.json(
          { error: "Booking does not belong to this user" },
          { status: 403 }
        );
      }
    }

    // Verify event registration belongs to this user (if provided)
    if (body.event_registration_id) {
      const { data: reg } = await supabase
        .from("event_registrations")
        .select("id, user_id")
        .eq("id", body.event_registration_id)
        .single();

      if (!reg || reg.user_id !== auth.user.id) {
        return NextResponse.json(
          { error: "Registration not found" },
          { status: 404 }
        );
      }
    }

    // Get stripe account ID for verification
    const { data: settings } = await supabase
      .from("org_payment_settings")
      .select("stripe_account_id, payment_mode")
      .eq("org_id", org.id)
      .single();

    if (!settings?.stripe_account_id) {
      return NextResponse.json(
        { error: "Payment settings not configured" },
        { status: 400 }
      );
    }

    // Verify intent status with Stripe
    let paymentMethodId: string | null =
      body.stripe_payment_method_id || null;

    if (body.intent_type === "payment") {
      const pi = await stripe.paymentIntents.retrieve(
        body.intent_id,
        {},
        { stripeAccount: settings.stripe_account_id } as Stripe.RequestOptions
      );

      if (pi.status !== "succeeded") {
        return NextResponse.json(
          { error: `Payment not completed. Status: ${pi.status}` },
          { status: 400 }
        );
      }
      paymentMethodId =
        paymentMethodId ||
        (typeof pi.payment_method === "string"
          ? pi.payment_method
          : pi.payment_method?.id ?? null);
    } else {
      const si = await stripe.setupIntents.retrieve(
        body.intent_id,
        {},
        { stripeAccount: settings.stripe_account_id } as Stripe.RequestOptions
      );

      if (si.status !== "succeeded") {
        return NextResponse.json(
          { error: `Card setup not completed. Status: ${si.status}` },
          { status: 400 }
        );
      }
      paymentMethodId =
        paymentMethodId ||
        (typeof si.payment_method === "string"
          ? si.payment_method
          : si.payment_method?.id ?? null);
    }

    // Determine status and charge_type
    const isUpfront = settings.payment_mode === "charge_upfront";
    const status = isUpfront ? "charged" : "card_saved";
    const chargeType = isUpfront ? "upfront" : null;

    // Insert booking_payments row
    const { data: payment, error: insertError } = await supabase
      .from("booking_payments")
      .insert({
        booking_id: body.booking_id || null,
        event_registration_id: body.event_registration_id || null,
        org_id: org.id,
        customer_email: auth.profile.email,
        stripe_customer_id: body.stripe_customer_id,
        stripe_payment_intent_id:
          body.intent_type === "payment" ? body.intent_id : null,
        stripe_setup_intent_id:
          body.intent_type === "setup" ? body.intent_id : null,
        stripe_payment_method_id: paymentMethodId,
        status,
        amount_cents: isUpfront ? body.amount_cents : null,
        charge_type: chargeType,
        charged_at: isUpfront ? new Date().toISOString() : null,
        cancellation_policy_text: body.cancellation_policy_text || null,
        policy_agreed_at: body.policy_agreed_at || null,
      })
      .select("id, status")
      .single();

    if (insertError) {
      console.error("[mobile/record-booking-payment] insert error:", insertError);
      return NextResponse.json(
        { error: `Failed to record payment: ${insertError.message}` },
        { status: 500 }
      );
    }

    // For event registrations: update status to confirmed and payment_status to paid
    if (body.event_registration_id && isUpfront) {
      await supabase
        .from("event_registrations")
        .update({ status: "confirmed", payment_status: "paid" })
        .eq("id", body.event_registration_id);
    }

    return NextResponse.json(payment);
  } catch (err) {
    console.error("[mobile/record-booking-payment] error:", err);

    if (err instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { error: err.message || "Stripe error" },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
