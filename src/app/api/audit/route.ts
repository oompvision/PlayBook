import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { logAudit, type AuditAction } from "@/lib/audit";
import { validateBody } from "@/lib/validation";
import { z } from "zod/v4";

const auditSchema = z.object({
  action: z.enum(["login", "login_failed", "logout"]),
  resourceType: z.string().min(1).max(100),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST /api/audit
 * Lightweight endpoint for client components to log audit events.
 * Used by login/signup pages to record authentication events.
 */
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, auditSchema);
  if (parsed.error) return parsed.error;

  const { action, resourceType, metadata } = parsed.data;

  const auth = await getAuthUser();

  await logAudit({
    userId: auth?.profile.id || null,
    orgId: auth?.profile.org_id || null,
    action: action as AuditAction,
    resourceType,
    metadata,
  });

  return NextResponse.json({ ok: true });
}
