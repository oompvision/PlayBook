import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getAuthUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import {
  pickBayForBooking,
  type DynamicScheduleRule,
  type ExistingBooking,
  type BlockOut,
  type BayInfo,
} from "@/lib/availability-engine";
import { createNotification, notifyOrgAdmins } from "@/lib/notifications";
import { formatTimeInZone } from "@/lib/utils";
import { z } from "zod/v4";

const bookingSchema = z.object({
  org_id: z.string().uuid(),
  bay_id: z.string().uuid().optional(),
  group_id: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  price_cents: z.number().int().min(0),
  notes: z.string().max(1000).nullish(),
  location_id: z.string().uuid().nullish(),
  discount_cents: z.number().int().min(0).nullish(),
  discount_description: z.string().max(200).nullish(),
});

/**
 * POST /api/bookings/dynamic
 *
 * Creates a dynamic booking. For group bookings, performs server-side
 * consolidation to pick the best bay.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bookingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid booking data" },
      { status: 400 }
    );
  }

  const { org_id, bay_id, group_id, date, start_time, end_time, price_cents, notes, location_id, discount_cents, discount_description } =
    parsed.data;

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

  let targetBayId: string | undefined = bay_id;

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
    }) ?? undefined;

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
    p_discount_cents: discount_cents || 0,
    p_discount_description: discount_description || null,
  });

  if (error) {
    console.error("[bookings/dynamic] create_dynamic_booking error:", error.message);
    return NextResponse.json({ error: "Booking could not be completed. Please try again." }, { status: 409 });
  }

  // Get the bay name for the response
  const { data: bayData } = await supabase
    .from("bays")
    .select("name")
    .eq("id", targetBayId)
    .single();

  const bayName = bayData?.name || "Facility";

  // Fire booking notifications (non-blocking)
  fireBookingNotifications({
    orgId: org_id,
    timezone: org.timezone,
    customerId: auth.profile.id,
    customerEmail: auth.profile.email,
    customerName: auth.profile.full_name || auth.profile.email,
    bookingId: data?.booking_id,
    confirmationCode: data?.confirmation_code,
    bayName,
    date,
    startTime: start_time,
    endTime: end_time,
    totalPriceCents: price_cents,
  }).catch((err) => {
    console.error("[bookings/dynamic] Notification error:", err);
  });

  return NextResponse.json({
    ...data,
    bay_id: targetBayId,
    bay_name: bayName,
  });
}

// ── Non-blocking notification helper ──────────────────────
async function fireBookingNotifications(params: {
  orgId: string;
  timezone: string;
  customerId: string;
  customerEmail: string;
  customerName: string;
  bookingId?: string;
  confirmationCode?: string;
  bayName: string;
  date: string;
  startTime: string;
  endTime: string;
  totalPriceCents: number;
}) {
  const {
    orgId, timezone, customerId, customerEmail, customerName,
    confirmationCode, bayName, date, startTime, endTime, totalPriceCents,
  } = params;

  const svc = createServiceClient();
  const { data: org } = await svc
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .single();
  const orgName = org?.name ?? "EZBooker";

  const timeStr = `${formatTimeInZone(startTime, timezone)} – ${formatTimeInZone(endTime, timezone)}`;
  const dateStr = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const priceStr = `$${(totalPriceCents / 100).toFixed(2)}`;
  const code = confirmationCode ?? "";
  const bookingDetails = `${bayName} — ${dateStr}, ${timeStr}\nConfirmation: ${code}\nTotal: ${priceStr}`;

  const bookingMeta = {
    confirmation_code: code,
    bay: bayName,
    dateStr,
    timeStr,
    totalPrice: priceStr,
    customerName,
  };

  // Customer notification
  await createNotification({
    orgId,
    recipientId: customerId,
    recipientType: "customer",
    type: "booking_confirmed",
    title: "Booking Confirmed",
    message: bookingDetails,
    link: `/my-bookings?booking=${code}`,
    recipientEmail: customerEmail,
    recipientName: customerName,
    orgName,
    metadata: bookingMeta,
  });

  // Admin notification
  await notifyOrgAdmins(orgId, orgName, {
    type: "booking_confirmed",
    title: `New Booking: ${code}`,
    message: `${customerName} booked ${bayName} — ${dateStr}, ${timeStr} (${priceStr})`,
    link: `/admin/bookings?booking=${code}`,
    metadata: bookingMeta,
  });
}
