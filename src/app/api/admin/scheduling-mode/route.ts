import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth";
import { getFacilitySlug } from "@/lib/facility";
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { validateBody } from "@/lib/validation";
import { schedulingModeSchema } from "@/lib/schemas/admin";

export async function PUT(request: NextRequest) {
  const slug = await getFacilitySlug();
  if (!slug) {
    return NextResponse.json({ error: "No facility context" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();

  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  await requireAdmin(org.id);

  const parsed = await validateBody(request, schedulingModeSchema);
  if (parsed.error) return parsed.error;
  const { scheduling_type, bookable_window_days } = parsed.data;

  // Use service role client to bypass RLS — auth is already verified above
  const service = createServiceClient();
  const { error } = await service
    .from("organizations")
    .update({ scheduling_type, bookable_window_days })
    .eq("id", org.id);

  if (error) {
    logger.error("[admin/scheduling-mode] update error", { message: error.message });
    return NextResponse.json({ error: "Failed to update scheduling mode" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
