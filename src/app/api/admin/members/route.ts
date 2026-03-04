import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/members?action=search&org_id=...&q=...
 *
 * Searches customers in the org for the grant membership modal.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const action = searchParams.get("action");
  const orgId = searchParams.get("org_id");
  const q = searchParams.get("q");

  if (action !== "search" || !orgId) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  await requireAdmin(orgId);

  const supabase = await createClient();

  let query = supabase
    .from("profiles")
    .select("id, full_name, email, phone")
    .eq("org_id", orgId)
    .eq("role", "customer")
    .limit(20);

  if (q) {
    query = query.or(
      `full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ customers: data || [] });
}

/**
 * POST /api/admin/members
 *
 * Grant admin membership to a customer.
 * Body: { org_id, user_id, expires_at? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { org_id, user_id, expires_at } = body;

  if (!org_id || !user_id) {
    return NextResponse.json(
      { error: "org_id and user_id are required" },
      { status: 400 }
    );
  }

  await requireAdmin(org_id);

  const supabase = await createClient();

  // Get the membership tier for this org
  const { data: tier } = await supabase
    .from("membership_tiers")
    .select("id")
    .eq("org_id", org_id)
    .single();

  if (!tier) {
    return NextResponse.json(
      { error: "No membership tier configured for this organization" },
      { status: 400 }
    );
  }

  // Check if user already has a membership
  const { data: existing } = await supabase
    .from("user_memberships")
    .select("id, status")
    .eq("org_id", org_id)
    .eq("user_id", user_id)
    .single();

  if (existing && (existing.status === "active" || existing.status === "admin_granted")) {
    return NextResponse.json(
      { error: "User already has an active membership" },
      { status: 409 }
    );
  }

  // If there's a cancelled/expired membership, update it; otherwise insert
  if (existing) {
    const { error } = await supabase
      .from("user_memberships")
      .update({
        status: "admin_granted",
        source: "admin",
        tier_id: tier.id,
        expires_at: expires_at || null,
        cancelled_at: null,
        stripe_subscription_id: null,
        stripe_customer_id: null,
        current_period_end: null,
      })
      .eq("id", existing.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await supabase.from("user_memberships").insert({
      org_id,
      user_id,
      tier_id: tier.id,
      status: "admin_granted",
      source: "admin",
      expires_at: expires_at || null,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/admin/members
 *
 * Revoke an admin-granted membership.
 * Body: { membership_id, org_id }
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { membership_id, org_id } = body;

  if (!membership_id || !org_id) {
    return NextResponse.json(
      { error: "membership_id and org_id are required" },
      { status: 400 }
    );
  }

  await requireAdmin(org_id);

  const supabase = await createClient();

  // Verify membership exists and is admin-granted
  const { data: membership } = await supabase
    .from("user_memberships")
    .select("id, source")
    .eq("id", membership_id)
    .eq("org_id", org_id)
    .single();

  if (!membership) {
    return NextResponse.json(
      { error: "Membership not found" },
      { status: 404 }
    );
  }

  if (membership.source !== "admin") {
    return NextResponse.json(
      { error: "Only admin-granted memberships can be revoked. Stripe memberships must be cancelled by the customer." },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("user_memberships")
    .delete()
    .eq("id", membership_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
