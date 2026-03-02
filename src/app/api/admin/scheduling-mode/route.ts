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
  const { scheduling_type, bookable_window_days } = body;

  if (!["slot_based", "dynamic"].includes(scheduling_type)) {
    return NextResponse.json(
      { error: "Invalid scheduling_type" },
      { status: 400 }
    );
  }

  if (
    typeof bookable_window_days !== "number" ||
    bookable_window_days < 1 ||
    bookable_window_days > 365
  ) {
    return NextResponse.json(
      { error: "bookable_window_days must be between 1 and 365" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("organizations")
    .update({ scheduling_type, bookable_window_days })
    .eq("id", org.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
