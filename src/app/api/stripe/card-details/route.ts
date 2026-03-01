import { NextRequest, NextResponse } from "next/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";

/**
 * GET /api/stripe/card-details?pm=pm_xxx
 * Retrieves card brand + last4 from a Stripe payment method ID
 * on the org's connected account.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pmId = request.nextUrl.searchParams.get("pm");
    if (!pmId) {
      return NextResponse.json(
        { error: "pm parameter is required" },
        { status: 400 }
      );
    }

    // Resolve org → stripe account
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
        { error: "Payment not configured" },
        { status: 400 }
      );
    }

    // Retrieve the payment method from the connected account
    const pm = await stripe.paymentMethods.retrieve(pmId, {
      stripeAccount: settings.stripe_account_id,
    });

    return NextResponse.json({
      brand: pm.card?.brand || null,
      last4: pm.card?.last4 || null,
    });
  } catch (err) {
    console.error("[card-details] error:", err);
    return NextResponse.json({ error: "Failed to retrieve card details" }, { status: 500 });
  }
}
