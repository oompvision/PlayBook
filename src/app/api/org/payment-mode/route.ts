import { NextResponse } from "next/server";
import { getFacilitySlug } from "@/lib/facility";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/org/payment-mode
 * Public endpoint — returns the org's payment mode and related settings
 * for the customer-facing booking widget. No auth required.
 * Uses service client to bypass RLS (customers can't read org_payment_settings).
 */
export async function GET() {
  try {
    const slug = await getFacilitySlug();
    if (!slug) {
      return NextResponse.json(
        { error: "Facility not found" },
        { status: 404 }
      );
    }

    const supabase = createServiceClient();

    // Resolve org
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

    // Fetch payment settings
    const { data: settings } = await supabase
      .from("org_payment_settings")
      .select(
        "payment_mode, stripe_onboarding_complete, cancellation_window_hours, no_show_fee_cents, no_show_fee_type"
      )
      .eq("org_id", org.id)
      .single();

    if (!settings) {
      return NextResponse.json({
        payment_mode: "none",
        requires_payment: false,
        cancellation_window_hours: 24,
        no_show_fee_cents: null,
        no_show_fee_type: "fixed",
      });
    }

    const requiresPayment =
      settings.payment_mode !== "none" &&
      settings.stripe_onboarding_complete === true;

    return NextResponse.json({
      payment_mode: settings.payment_mode,
      requires_payment: requiresPayment,
      cancellation_window_hours: settings.cancellation_window_hours,
      no_show_fee_cents: settings.no_show_fee_cents,
      no_show_fee_type: settings.no_show_fee_type,
    });
  } catch (err) {
    console.error("[payment-mode] GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
