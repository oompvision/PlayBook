import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAdminAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { z } from "zod/v4";
import { validateBody } from "@/lib/validation";

const paymentSettingsSchema = z.object({
  payment_mode: z.enum(["none", "hold", "charge_upfront", "hold_charge_manual"]).optional(),
  cancellation_window_hours: z.number().int().min(0).optional(),
  no_show_fee_cents: z.number().int().min(0).optional(),
  no_show_fee_type: z.enum(["fixed", "full_booking"]).optional(),
  processing_fee_absorbed_by: z.enum(["customer", "org"]).optional(),
  cancellation_policy_text: z.string().max(5000).optional(),
});

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
          logger.error("[payment-settings] insert error", { message: error.message });
          return NextResponse.json(
            { error: "Failed to create payment settings" },
            { status: 500 }
          );
        }
      } else {
        settings = newSettings;
      }
    }

    return NextResponse.json(settings);
  } catch (err) {
    logger.error("[payment-settings] GET error", err);
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

    const parsed = await validateBody(request, paymentSettingsSchema);
    if (parsed.error) return parsed.error;
    const body = parsed.data;

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

    // Build the update object from validated fields (Zod strips unknown keys)
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        updateData[key] = value;
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
      logger.error("[payment-settings] update error", { message: error.message });
      return NextResponse.json(
        { error: "Failed to update payment settings" },
        { status: 500 }
      );
    }

    return NextResponse.json(updated);
  } catch (err) {
    logger.error("[payment-settings] PUT error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
