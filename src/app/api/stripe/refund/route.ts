import { NextRequest, NextResponse } from "next/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

/**
 * POST /api/stripe/refund
 * Processes a full or partial refund on a booking's payment.
 * Admin-only endpoint.
 *
 * Body:
 *   booking_id: string
 *   refund_type: "full" | "partial"
 *   amount_cents?: number       (required if refund_type = "partial")
 *   amount_percent?: number     (alternative to amount_cents for partial)
 *   note?: string               (admin note for why refund was issued)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Must be admin or super_admin
    if (
      auth.profile.role !== "admin" &&
      auth.profile.role !== "super_admin"
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as {
      booking_id: string;
      refund_type: "full" | "partial";
      amount_cents?: number;
      amount_percent?: number;
      note?: string;
    };

    if (!body.booking_id || !body.refund_type) {
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

    // Get payment settings for stripe_account_id
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

    // Get the booking payment record
    const { data: payment } = await supabase
      .from("booking_payments")
      .select("*")
      .eq("booking_id", body.booking_id)
      .eq("org_id", org.id)
      .single();

    if (!payment) {
      return NextResponse.json(
        { error: "No payment record found for this booking" },
        { status: 404 }
      );
    }

    // Can only refund payments that have been charged
    if (
      payment.status !== "charged" &&
      payment.status !== "partially_refunded"
    ) {
      return NextResponse.json(
        {
          error: `Cannot refund a payment with status "${payment.status}". Only charged or partially refunded payments can be refunded.`,
        },
        { status: 400 }
      );
    }

    if (!payment.stripe_payment_intent_id) {
      return NextResponse.json(
        { error: "No Stripe PaymentIntent found for this booking. Refund must be processed manually." },
        { status: 400 }
      );
    }

    const chargedAmount = payment.amount_cents || 0;
    const alreadyRefunded = payment.refunded_amount_cents || 0;
    const refundable = chargedAmount - alreadyRefunded;

    if (refundable <= 0) {
      return NextResponse.json(
        { error: "This payment has already been fully refunded" },
        { status: 400 }
      );
    }

    // Calculate refund amount
    let refundAmountCents: number;

    if (body.refund_type === "full") {
      refundAmountCents = refundable;
    } else {
      // Partial refund — resolve from cents or percent
      if (body.amount_cents != null && body.amount_cents > 0) {
        refundAmountCents = body.amount_cents;
      } else if (body.amount_percent != null && body.amount_percent > 0) {
        refundAmountCents = Math.round(
          (chargedAmount * body.amount_percent) / 100
        );
      } else {
        return NextResponse.json(
          { error: "Partial refund requires amount_cents or amount_percent" },
          { status: 400 }
        );
      }

      if (refundAmountCents > refundable) {
        return NextResponse.json(
          {
            error: `Refund amount ($${(refundAmountCents / 100).toFixed(2)}) exceeds refundable balance ($${(refundable / 100).toFixed(2)})`,
          },
          { status: 400 }
        );
      }
    }

    // Process refund via Stripe
    const stripeAccountId = settings.stripe_account_id;

    await stripe.refunds.create(
      {
        payment_intent: payment.stripe_payment_intent_id,
        amount: refundAmountCents,
      },
      { stripeAccount: stripeAccountId }
    );

    // Update booking_payments record
    const totalRefunded = alreadyRefunded + refundAmountCents;
    const isFullyRefunded = totalRefunded >= chargedAmount;

    await supabase
      .from("booking_payments")
      .update({
        status: isFullyRefunded ? "refunded" : "partially_refunded",
        refunded_amount_cents: totalRefunded,
        refund_note: body.note || null,
        refunded_at: new Date().toISOString(),
        refunded_by: auth.profile.id,
      })
      .eq("id", payment.id);

    return NextResponse.json({
      success: true,
      refunded_amount_cents: refundAmountCents,
      total_refunded_cents: totalRefunded,
      status: isFullyRefunded ? "refunded" : "partially_refunded",
    });
  } catch (err) {
    console.error("[refund] error:", err);

    if (err instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { error: err.message || "Stripe refund error" },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
