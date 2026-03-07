import { createServiceClient } from "@/lib/supabase/service";
import { getAdminAuth } from "@/lib/auth";
import { getFacilitySlug } from "@/lib/facility";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(request: NextRequest) {
  const slug = await getFacilitySlug();
  if (!slug) {
    return NextResponse.json({ error: "No facility context" }, { status: 400 });
  }

  // Use service role for all DB operations — auth checked separately
  const service = createServiceClient();

  const { data: org } = await service
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();

  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // Use getAdminAuth (returns null) instead of requireAdmin (calls redirect())
  // redirect() in Route Handlers causes fetch() to follow the redirect and
  // return 200 HTML, making the client think the save succeeded
  const auth = await getAdminAuth(org.id);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    const { data: publishedEvents } = await service
      .from("events")
      .select("id")
      .eq("org_id", org.id)
      .eq("status", "published")
      .gt("end_time", new Date().toISOString());

    if (publishedEvents && publishedEvents.length > 0) {
      const eventIds = publishedEvents.map((e) => e.id);
      const { count: regCount } = await service
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

  // Update and read back the persisted value to verify it worked
  const { data: updated, error } = await service
    .from("organizations")
    .update({ events_enabled })
    .eq("id", org.id)
    .select("events_enabled")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json(
      { error: "Update did not match any rows" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    events_enabled: updated.events_enabled,
  });
}
