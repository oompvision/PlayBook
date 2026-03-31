import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { logAudit, type AuditAction } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";
import { validateBody } from "@/lib/validation";
import { z } from "zod/v4";

const auditSchema = z.object({
  action: z.enum(["login", "login_failed", "logout"]),
  resourceType: z.string().min(1).max(100),
  metadata: z.record(z.string(), z.unknown()).optional(),
  email: z.string().email().optional(),
});

/**
 * POST /api/audit
 * Lightweight endpoint for client components to log audit events.
 * Also handles login attempt tracking and lockout checks.
 */
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, auditSchema);
  if (parsed.error) return parsed.error;

  const { action, resourceType, metadata, email } = parsed.data;

  const auth = await getAuthUser();

  // Record login attempts via service client (bypasses RLS)
  if ((action === "login" || action === "login_failed") && email) {
    const svc = createServiceClient();
    await svc.rpc("record_login_attempt", {
      p_email: email,
      p_ip: null,
      p_success: action === "login",
    });
  }

  await logAudit({
    userId: auth?.profile.id || null,
    orgId: auth?.profile.org_id || null,
    action: action as AuditAction,
    resourceType,
    metadata,
  });

  return NextResponse.json({ ok: true });
}

/**
 * GET /api/audit?email=...
 * Check if login is allowed (lockout status) for an email address.
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ allowed: true, attempts_remaining: 5 });
  }

  const svc = createServiceClient();
  const { data, error } = await svc.rpc("check_login_allowed", {
    p_email: email,
  });

  if (error || !data) {
    // If lockout check fails, allow login (fail open)
    return NextResponse.json({ allowed: true, attempts_remaining: 5 });
  }

  return NextResponse.json(data);
}
