/**
 * Application-level audit logging for SOC II compliance.
 * Used in API routes to log actions that aren't covered by DB triggers,
 * such as login attempts, data exports, and AI tool usage.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { headers } from "next/headers";
import { logger } from "@/lib/logger";

export type AuditAction =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "login"
  | "login_failed"
  | "logout"
  | "export";

interface AuditLogParams {
  orgId?: string | null;
  userId?: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

/**
 * Extract client IP and user agent from request headers.
 */
async function getRequestContext() {
  try {
    const headersList = await headers();
    const ip =
      headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      headersList.get("x-real-ip") ||
      null;
    const userAgent = headersList.get("user-agent") || null;
    return { ip, userAgent };
  } catch {
    // headers() may not be available in all contexts
    return { ip: null, userAgent: null };
  }
}

/**
 * Log an audit event. Non-blocking — errors are caught and logged
 * but never thrown to avoid disrupting the main request flow.
 */
export async function logAudit(params: AuditLogParams): Promise<void> {
  try {
    const { ip, userAgent } = await getRequestContext();
    const svc = createServiceClient();

    const { error } = await svc.from("audit_logs").insert({
      org_id: params.orgId || null,
      user_id: params.userId || null,
      action: params.action,
      resource_type: params.resourceType,
      resource_id: params.resourceId || null,
      old_value: params.oldValue || null,
      new_value: params.newValue || null,
      ip_address: ip,
      user_agent: userAgent,
      metadata: params.metadata || {},
    });

    if (error) {
      logger.error("[audit] Failed to write audit log", {
        error: error.message,
        action: params.action,
        resourceType: params.resourceType,
      });
    }
  } catch (err) {
    logger.error("[audit] Unexpected error writing audit log", err);
  }
}
