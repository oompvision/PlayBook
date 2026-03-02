import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  getAvailableTimesForBay,
  getPooledAvailability,
  type DynamicScheduleRule,
  type ExistingBooking,
  type BlockOut,
  type BayInfo,
  type AvailableTimeSlot,
} from "@/lib/availability-engine";

/**
 * GET /api/availability
 *
 * Returns available time slots for dynamic scheduling.
 *
 * Query params:
 *   org_id     — required
 *   date       — required (YYYY-MM-DD)
 *   duration   — required (minutes)
 *   bay_id     — optional (specific bay)
 *   group_id   — optional (facility group — pooled availability)
 *
 * If neither bay_id nor group_id is provided, returns availability for all bays.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("org_id");
  const date = searchParams.get("date");
  const durationStr = searchParams.get("duration");
  const bayId = searchParams.get("bay_id");
  const groupId = searchParams.get("group_id");

  if (!orgId || !date || !durationStr) {
    return NextResponse.json(
      { error: "Missing required params: org_id, date, duration" },
      { status: 400 }
    );
  }

  const duration = parseInt(durationStr, 10);
  if (isNaN(duration) || duration < 1) {
    return NextResponse.json(
      { error: "Invalid duration" },
      { status: 400 }
    );
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Invalid date format (use YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Fetch org for timezone + bookable_window_days + min_booking_lead_minutes
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select(
      "id, timezone, bookable_window_days, min_booking_lead_minutes, scheduling_type"
    )
    .eq("id", orgId)
    .single();

  if (orgError || !org) {
    return NextResponse.json(
      { error: "Organization not found" },
      { status: 404 }
    );
  }

  if (org.scheduling_type !== "dynamic") {
    return NextResponse.json(
      { error: "Organization does not use dynamic scheduling" },
      { status: 400 }
    );
  }

  // Check bookable_window_days
  const today = new Date(
    new Intl.DateTimeFormat("en-CA", { timeZone: org.timezone }).format(
      new Date()
    )
  );
  const requestedDate = new Date(date + "T12:00:00");
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + (org.bookable_window_days || 30));

  if (requestedDate < today) {
    return NextResponse.json(
      { error: "Cannot book in the past" },
      { status: 400 }
    );
  }
  if (requestedDate > maxDate) {
    return NextResponse.json(
      { error: `Cannot book more than ${org.bookable_window_days} days ahead` },
      { status: 400 }
    );
  }

  // Determine which bays to check
  let bayIds: string[] = [];

  if (bayId) {
    bayIds = [bayId];
  } else if (groupId) {
    const { data: members } = await supabase
      .from("facility_group_members")
      .select("bay_id")
      .eq("group_id", groupId);
    bayIds = (members || []).map((m) => m.bay_id);
  } else {
    // All active bays for this org
    const { data: allBays } = await supabase
      .from("bays")
      .select("id")
      .eq("org_id", orgId)
      .eq("is_active", true);
    bayIds = (allBays || []).map((b) => b.id);
  }

  if (bayIds.length === 0) {
    return NextResponse.json({ slots: [] });
  }

  // Get day of week for the requested date (0=Sunday)
  const dayOfWeek = new Date(date + "T12:00:00").getDay();

  // Fetch rules, bookings, and block-outs in parallel
  const [rulesResult, baysResult, bookingsResult, blockOutsResult] =
    await Promise.all([
      supabase
        .from("dynamic_schedule_rules")
        .select("*")
        .in("bay_id", bayIds)
        .eq("day_of_week", dayOfWeek),
      supabase
        .from("bays")
        .select("id, name, hourly_rate_cents")
        .in("id", bayIds)
        .eq("is_active", true),
      supabase
        .from("bookings")
        .select("bay_id, start_time, end_time")
        .in("bay_id", bayIds)
        .eq("date", date)
        .eq("status", "confirmed"),
      supabase
        .from("schedule_block_outs")
        .select("bay_id, start_time, end_time")
        .in("bay_id", bayIds)
        .eq("date", date),
    ]);

  const rules = (rulesResult.data || []) as DynamicScheduleRule[];
  const bays = (baysResult.data || []) as BayInfo[];
  const bookings = bookingsResult.data || [];
  const blockOuts = blockOutsResult.data || [];

  // Build maps
  const rulesMap = new Map<string, DynamicScheduleRule>();
  for (const r of rules) {
    rulesMap.set(r.bay_id, r);
  }

  const bookingsMap = new Map<string, ExistingBooking[]>();
  for (const b of bookings) {
    const list = bookingsMap.get(b.bay_id) || [];
    list.push({ start_time: b.start_time, end_time: b.end_time });
    bookingsMap.set(b.bay_id, list);
  }

  const blockOutsMap = new Map<string, BlockOut[]>();
  for (const bo of blockOuts) {
    const list = blockOutsMap.get(bo.bay_id) || [];
    list.push({ start_time: bo.start_time, end_time: bo.end_time });
    blockOutsMap.set(bo.bay_id, list);
  }

  let slots: AvailableTimeSlot[];

  if (groupId || bayIds.length > 1) {
    // Pooled availability across group/all bays
    slots = getPooledAvailability({
      bays,
      rulesMap,
      date,
      duration,
      timezone: org.timezone,
      bookingsMap,
      blockOutsMap,
      minBookingLeadMinutes: org.min_booking_lead_minutes ?? 0,
    });
  } else if (bays.length === 1) {
    // Single bay
    const bay = bays[0];
    const rule = rulesMap.get(bay.id);
    if (!rule) {
      return NextResponse.json({ slots: [] });
    }
    slots = getAvailableTimesForBay({
      bay,
      rule,
      date,
      duration,
      timezone: org.timezone,
      existingBookings: bookingsMap.get(bay.id) || [],
      blockOuts: blockOutsMap.get(bay.id) || [],
      minBookingLeadMinutes: org.min_booking_lead_minutes ?? 0,
    });
  } else {
    slots = [];
  }

  // Also return the available durations from the first rule (for the UI)
  const availableDurations = rules.length > 0 ? rules[0].available_durations : [];

  return NextResponse.json({ slots, available_durations: availableDurations });
}
