import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { logger } from "@/lib/logger";

/**
 * POST /api/auth/delete-account
 * Anonymizes user data and deletes the auth account.
 * Preserves booking and payment records with anonymized PII.
 */
export async function POST() {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const svc = createServiceClient();

  // 1. Anonymize all user data (preserves bookings + payments)
  const { data, error: anonError } = await svc.rpc("anonymize_account", {
    p_user_id: auth.user.id,
  });

  if (anonError) {
    logger.error("[delete-account] anonymize_account RPC failed", { message: anonError.message });
    return NextResponse.json({ error: "Account deletion failed. Please try again." }, { status: 500 });
  }

  const result = data as { success: boolean; error?: string };
  if (!result?.success) {
    logger.error("[delete-account] anonymize_account returned failure", { result });
    return NextResponse.json({ error: result?.error || "Account deletion failed." }, { status: 500 });
  }

  // 2. Delete the auth user (cascades profile deletion)
  const { error: deleteError } = await svc.auth.admin.deleteUser(auth.user.id);

  if (deleteError) {
    logger.error("[delete-account] auth.admin.deleteUser failed", { message: deleteError.message });
    return NextResponse.json(
      { error: "Account data was anonymized but auth deletion failed. Contact support." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
