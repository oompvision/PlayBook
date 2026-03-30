import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { logAudit, type AuditAction } from "@/lib/audit";

/**
 * POST /api/audit
 * Lightweight endpoint for client components to log audit events.
 * Used by login/signup pages to record authentication events.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, resourceType, metadata } = body as {
    action: AuditAction;
    resourceType: string;
    metadata?: Record<string, unknown>;
  };

  if (!action || !resourceType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Only allow auth-related audit events from this endpoint
  const allowedActions: AuditAction[] = ["login", "login_failed", "logout"];
  if (!allowedActions.includes(action)) {
    return NextResponse.json({ error: "Action not allowed" }, { status: 403 });
  }

  const auth = await getAuthUser();

  await logAudit({
    userId: auth?.profile.id || null,
    orgId: auth?.profile.org_id || null,
    action,
    resourceType,
    metadata,
  });

  return NextResponse.json({ ok: true });
}
