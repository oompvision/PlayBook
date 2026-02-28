import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import Stripe from "stripe";

/**
 * POST /api/stripe/webhooks/connect
 * Handles Stripe Connect webhook events (account.updated).
 * Uses service-role Supabase client since webhooks have no user session.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_CONNECT_WEBHOOK_SECRET!
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[stripe/webhooks/connect] Signature verification failed:", message);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const isComplete =
          account.charges_enabled && account.details_submitted;

        const supabase = createServiceClient();

        await supabase
          .from("org_payment_settings")
          .update({ stripe_onboarding_complete: isComplete })
          .eq("stripe_account_id", account.id);

        console.log(
          `[stripe/webhooks/connect] account.updated: ${account.id} → onboarding_complete=${isComplete}`
        );
        break;
      }
      default:
        console.log(
          `[stripe/webhooks/connect] Unhandled event type: ${event.type}`
        );
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[stripe/webhooks/connect] Processing error:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
