import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logger } from "@/lib/logger";

/**
 * GET /api/cron/data-retention
 * Scheduled cleanup of expired data per SOC II retention policies.
 * - audit_logs: delete entries older than 1 year
 * - login_attempts: delete entries older than 24 hours
 *
 * Auth: CRON_SECRET Bearer token (same pattern as other cron endpoints).
 * Schedule: Daily at 3 AM UTC via Vercel Cron or external scheduler.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("cleanup_expired_data");

  if (error) {
    logger.error("[cron/data-retention] cleanup_expired_data failed", { message: error.message });
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }

  const result = data as {
    success: boolean;
    audit_logs_deleted: number;
    login_attempts_deleted: number;
  };

  logger.info("[cron/data-retention] cleanup complete", result);

  return NextResponse.json(result);
}
