import { NextRequest, NextResponse } from "next/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

/**
 * POST /api/stripe/cancel-intent
 * Refunds a PaymentIntent or cancels a SetupIntent.
 * Used when a booking fails after payment has succeeded.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { intent_id, intent_type } = (await request.json()) as {
      intent_id: string;
      intent_type: "payment" | "setup";
    };

    if (!intent_id || !intent_type) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Resolve org → get stripe_account_id
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

    const { data: settings } = await supabase
      .from("org_payment_settings")
      .select("stripe_account_id")
      .eq("org_id", org.id)
      .single();

    if (!settings?.stripe_account_id) {
      return NextResponse.json(
        { error: "Payment settings not configured" },
        { status: 400 }
      );
    }

    const stripeAccountId = settings.stripe_account_id;

    if (intent_type === "payment") {
      // Verify the PI belongs to this user before refunding
      const pi = await stripe.paymentIntents.retrieve(intent_id, {}, {
        stripeAccount: stripeAccountId,
      } as Stripe.RequestOptions);

      if (pi.metadata?.profile_id !== auth.profile.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }

      if (pi.status === "succeeded") {
        await stripe.refunds.create(
          { payment_intent: intent_id },
          { stripeAccount: stripeAccountId }
        );
      } else if (pi.status === "requires_capture") {
        await stripe.paymentIntents.cancel(intent_id, {
          stripeAccount: stripeAccountId,
        } as Stripe.RequestOptions);
      }
    } else {
      // Cancel SetupIntent
      const si = await stripe.setupIntents.retrieve(intent_id, {}, {
        stripeAccount: stripeAccountId,
      } as Stripe.RequestOptions);

      if (si.metadata?.profile_id !== auth.profile.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }

      if (
        si.status !== "canceled" &&
        si.status !== "succeeded"
      ) {
        await stripe.setupIntents.cancel(intent_id, {}, {
          stripeAccount: stripeAccountId,
        } as Stripe.RequestOptions);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[cancel-intent] error:", err);

    if (err instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { error: err.message || "Stripe error" },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
