import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

/**
 * POST /api/stripe/auto-refund
 * Automatically processes a full refund when a customer cancels outside the cancellation window.
 * Called from the customer cancellation flow (client-side, after cancel_booking RPC succeeds).
 *
 * Body:
 *   booking_id: string
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { booking_id } = (await request.json()) as { booking_id: string };

    if (!booking_id) {
      return NextResponse.json(
        { error: "Missing booking_id" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Get the booking
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, org_id, customer_id, start_time")
      .eq("id", booking_id)
      .single();

    if (!booking) {
      return NextResponse.json(
        { error: "Booking not found" },
        { status: 404 }
      );
    }

    // Verify the caller owns this booking
    if (booking.customer_id !== auth.profile.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get payment settings
    const { data: settings } = await supabase
      .from("org_payment_settings")
      .select(
        "stripe_account_id, payment_mode, cancellation_window_hours"
      )
      .eq("org_id", booking.org_id)
      .single();

    if (
      !settings ||
      settings.payment_mode === "none" ||
      !settings.stripe_account_id
    ) {
      return NextResponse.json({ status: "no_payment_configured" });
    }

    // Get the payment record
    const { data: payment } = await supabase
      .from("booking_payments")
      .select("*")
      .eq("booking_id", booking_id)
      .eq("org_id", booking.org_id)
      .single();

    if (!payment) {
      return NextResponse.json({ status: "no_payment_record" });
    }

    // Only auto-refund charge_upfront payments that have been charged
    if (payment.status !== "charged") {
      // For hold modes, release the card hold
      if (payment.status === "card_saved") {
        await supabase
          .from("booking_payments")
          .update({
            status: "released",
            released_at: new Date().toISOString(),
          })
          .eq("id", payment.id);

        return NextResponse.json({
          status: "released",
          message: "Card hold released",
        });
      }
      return NextResponse.json({ status: "not_refundable" });
    }

    if (!payment.stripe_payment_intent_id) {
      return NextResponse.json({ status: "no_payment_intent" });
    }

    // Check if outside the cancellation window
    const windowHours = settings.cancellation_window_hours ?? 24;
    const bookingStart = new Date(booking.start_time).getTime();
    const windowCutoff = bookingStart - windowHours * 60 * 60 * 1000;
    const now = Date.now();

    if (now >= windowCutoff) {
      // Inside the cancellation window — no automatic refund
      return NextResponse.json({
        status: "inside_window",
        message: "Cancellation is within the no-refund window. No automatic refund issued.",
      });
    }

    // Outside the window — process full refund
    const stripeAccountId = settings.stripe_account_id;
    const refundAmount = payment.amount_cents || 0;

    if (refundAmount <= 0) {
      return NextResponse.json({ status: "zero_amount" });
    }

    await stripe.refunds.create(
      {
        payment_intent: payment.stripe_payment_intent_id,
        amount: refundAmount,
      },
      { stripeAccount: stripeAccountId }
    );

    // Update payment record
    await supabase
      .from("booking_payments")
      .update({
        status: "refunded",
        refunded_amount_cents: refundAmount,
        refunded_at: new Date().toISOString(),
        refund_note: "Automatic refund — cancelled outside cancellation window",
      })
      .eq("id", payment.id);

    return NextResponse.json({
      status: "refunded",
      refunded_amount_cents: refundAmount,
    });
  } catch (err) {
    console.error("[auto-refund] error:", err);

    if (err instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { error: err.message || "Stripe refund error" },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
