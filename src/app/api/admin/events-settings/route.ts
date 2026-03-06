import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { getFacilitySlug } from "@/lib/facility";
import { NextRequest, NextResponse } from "next/server";

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

  const body = await request.json();
  const { events_enabled } = body;

  if (typeof events_enabled !== "boolean") {
    return NextResponse.json(
      { error: "events_enabled must be a boolean" },
      { status: 400 }
    );
  }

  // If disabling, check for published events with active registrations
  if (!events_enabled) {
    const { count } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("status", "published")
      .gt("end_time", new Date().toISOString());

    // Check if any of those events have active registrations
    if (count && count > 0) {
      const { data: eventsWithRegs } = await supabase
        .from("events")
        .select("id")
        .eq("org_id", org.id)
        .eq("status", "published")
        .gt("end_time", new Date().toISOString());

      if (eventsWithRegs && eventsWithRegs.length > 0) {
        const eventIds = eventsWithRegs.map((e) => e.id);
        const { count: regCount } = await supabase
          .from("event_registrations")
          .select("id", { count: "exact", head: true })
          .in("event_id", eventIds)
          .in("status", ["confirmed", "pending_payment"]);

        if (regCount && regCount > 0) {
          return NextResponse.json(
            {
              error:
                "Cannot disable events while there are published events with active registrations. Cancel or complete all events first.",
            },
            { status: 409 }
          );
        }
      }
    }
  }

  const { error } = await supabase
    .from("organizations")
    .update({ events_enabled })
    .eq("id", org.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
