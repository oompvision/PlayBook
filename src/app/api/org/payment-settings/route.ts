import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAdminAuth } from "@/lib/auth";

const VALID_PAYMENT_MODES = [
  "none",
  "hold",
  "charge_upfront",
  "hold_charge_manual",
] as const;

const VALID_FEE_TYPES = ["fixed", "full_booking"] as const;
const VALID_FEE_ABSORBED_BY = ["customer", "org"] as const;

/**
 * Resolve the current org from the facility slug header.
 */
async function resolveOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, slug")
    .eq("slug", slug)
    .single();

  return org;
}

/**
 * GET /api/org/payment-settings
 * Returns the org's payment settings. Creates a default row if none exists.
 */
export async function GET(_request: NextRequest) {
  try {
    const org = await resolveOrg();
    if (!org) {
      return NextResponse.json(
        { error: "Facility not found" },
        { status: 404 }
      );
    }

    const auth = await getAdminAuth(org.id);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createClient();

    // Try to fetch existing settings
    let { data: settings } = await supabase
      .from("org_payment_settings")
      .select("*")
      .eq("org_id", org.id)
      .single();

    // Create default row if none exists
    if (!settings) {
      const { data: newSettings, error } = await supabase
        .from("org_payment_settings")
        .insert({ org_id: org.id })
        .select("*")
        .single();

      if (error) {
        // Race condition: another request may have inserted first
        if (error.code === "23505") {
          const { data: existing } = await supabase
            .from("org_payment_settings")
            .select("*")
            .eq("org_id", org.id)
            .single();
          settings = existing;
        } else {
          return NextResponse.json(
            { error: `Failed to create payment settings: ${error.message}` },
            { status: 500 }
          );
        }
      } else {
        settings = newSettings;
      }
    }

    return NextResponse.json(settings);
  } catch (err) {
    console.error("[payment-settings] GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * PUT /api/org/payment-settings
 * Updates the org's payment settings.
 */
export async function PUT(request: NextRequest) {
  try {
    const org = await resolveOrg();
    if (!org) {
      return NextResponse.json(
        { error: "Facility not found" },
        { status: 404 }
      );
    }

    const auth = await getAdminAuth(org.id);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Validate payment_mode
    if (body.payment_mode !== undefined) {
      if (
        !VALID_PAYMENT_MODES.includes(
          body.payment_mode as (typeof VALID_PAYMENT_MODES)[number]
        )
      ) {
        return NextResponse.json(
          {
            error: `Invalid payment_mode. Must be one of: ${VALID_PAYMENT_MODES.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    // Validate no_show_fee_type
    if (body.no_show_fee_type !== undefined) {
      if (
        !VALID_FEE_TYPES.includes(
          body.no_show_fee_type as (typeof VALID_FEE_TYPES)[number]
        )
      ) {
        return NextResponse.json(
          {
            error: `Invalid no_show_fee_type. Must be one of: ${VALID_FEE_TYPES.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    // Validate processing_fee_absorbed_by
    if (body.processing_fee_absorbed_by !== undefined) {
      if (
        !VALID_FEE_ABSORBED_BY.includes(
          body.processing_fee_absorbed_by as (typeof VALID_FEE_ABSORBED_BY)[number]
        )
      ) {
        return NextResponse.json(
          {
            error: `Invalid processing_fee_absorbed_by. Must be one of: ${VALID_FEE_ABSORBED_BY.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    const supabase = await createClient();

    // If switching to a payment mode that requires Stripe, verify onboarding is complete
    if (body.payment_mode && body.payment_mode !== "none") {
      const { data: current } = await supabase
        .from("org_payment_settings")
        .select("stripe_account_id, stripe_onboarding_complete")
        .eq("org_id", org.id)
        .single();

      if (!current?.stripe_account_id || !current?.stripe_onboarding_complete) {
        return NextResponse.json(
          {
            error:
              "Stripe Connect onboarding must be completed before enabling payment collection. Please connect your Stripe account first.",
          },
          { status: 400 }
        );
      }
    }

    // Build the update object with only allowed fields
    const allowedFields = [
      "payment_mode",
      "cancellation_window_hours",
      "no_show_fee_cents",
      "no_show_fee_type",
      "processing_fee_absorbed_by",
    ];

    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const { data: updated, error } = await supabase
      .from("org_payment_settings")
      .update(updateData)
      .eq("org_id", org.id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { error: `Failed to update payment settings: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[payment-settings] PUT error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
