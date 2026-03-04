import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import {
  pickBayForBooking,
  type DynamicScheduleRule,
  type ExistingBooking,
  type BlockOut,
  type BayInfo,
} from "@/lib/availability-engine";

/**
 * POST /api/bookings/dynamic
 *
 * Creates a dynamic booking. For group bookings, performs server-side
 * consolidation to pick the best bay.
 *
 * Body:
 *   org_id       — required
 *   bay_id       — optional (specific bay, for standalone bookings)
 *   group_id     — optional (facility group, triggers consolidation)
 *   date         — required (YYYY-MM-DD)
 *   start_time   — required (ISO timestamp)
 *   end_time     — required (ISO timestamp)
 *   price_cents  — required
 *   notes        — optional
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { org_id, bay_id, group_id, date, start_time, end_time, price_cents, notes, location_id } =
    body;

  if (!org_id || !date || !start_time || !end_time || price_cents == null) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  if (!bay_id && !group_id) {
    return NextResponse.json(
      { error: "Either bay_id or group_id is required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Fetch org timezone
  const { data: org } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", org_id)
    .single();

  if (!org) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 });
  }

  let targetBayId = bay_id;

  // If group booking, use consolidation to pick the best bay
  if (group_id && !bay_id) {
    const dayOfWeek = new Date(date + "T12:00:00").getDay();

    // Fetch group members
    const { data: members } = await supabase
      .from("facility_group_members")
      .select("bay_id")
      .eq("group_id", group_id);

    const bayIds = (members || []).map((m) => m.bay_id);
    if (bayIds.length === 0) {
      return NextResponse.json(
        { error: "Group has no facilities" },
        { status: 400 }
      );
    }

    // Fetch data for consolidation
    const [baysResult, rulesResult, bookingsResult, blockOutsResult] =
      await Promise.all([
        supabase
          .from("bays")
          .select("id, name, hourly_rate_cents")
          .in("id", bayIds)
          .eq("is_active", true),
        supabase
          .from("dynamic_schedule_rules")
          .select("*")
          .in("bay_id", bayIds)
          .eq("day_of_week", dayOfWeek),
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

    const baysData = (baysResult.data || []) as BayInfo[];
    const rules = (rulesResult.data || []) as DynamicScheduleRule[];
    const bookings = bookingsResult.data || [];
    const blockOuts = blockOutsResult.data || [];

    const rulesMap = new Map<string, DynamicScheduleRule>();
    for (const r of rules) rulesMap.set(r.bay_id, r);

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

    targetBayId = pickBayForBooking({
      bays: baysData,
      rulesMap,
      startTime: start_time,
      endTime: end_time,
      date,
      timezone: org.timezone,
      bookingsMap,
      blockOutsMap,
    });

    if (!targetBayId) {
      return NextResponse.json(
        { error: "No facility available for this time slot" },
        { status: 409 }
      );
    }
  }

  // Create the booking via RPC
  const { data, error } = await supabase.rpc("create_dynamic_booking", {
    p_org_id: org_id,
    p_customer_id: auth.profile.id,
    p_bay_id: targetBayId,
    p_date: date,
    p_start_time: start_time,
    p_end_time: end_time,
    p_price_cents: price_cents,
    p_notes: notes || null,
    p_location_id: location_id || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  // Get the bay name for the response
  const { data: bayData } = await supabase
    .from("bays")
    .select("name")
    .eq("id", targetBayId)
    .single();

  return NextResponse.json({
    ...data,
    bay_id: targetBayId,
    bay_name: bayData?.name || "Facility",
  });
}
