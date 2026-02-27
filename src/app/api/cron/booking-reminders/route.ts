import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createNotification } from "@/lib/notifications";
import { formatTimeInZone } from "@/lib/utils";

/**
 * Daily cron job for booking reminders (runs once at 8 AM UTC):
 * 1. 48-hour booking reminder to customers (checks 24–72h window)
 * 2. 24-hour cancellation window closed notice (checks 0–48h window)
 * Wide windows ensure nothing is missed with daily execution.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  let reminders48Sent = 0;
  let cancelWindowSent = 0;

  // ── 48-hour reminder ──────────────────────────────────────
  // Query bookings starting in 24-72 hours (wide window for daily cron)
  const hour24 = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const hour72 = new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString();

  const { data: upcoming48 } = await supabase
    .from("bookings")
    .select(
      "id, org_id, customer_id, bay_id, date, start_time, end_time, confirmation_code, total_price_cents"
    )
    .eq("status", "confirmed")
    .eq("is_guest", false)
    .is("reminder_48hr_sent_at", null)
    .gte("start_time", hour24)
    .lte("start_time", hour72);

  if (upcoming48 && upcoming48.length > 0) {
    for (const b of upcoming48) {
      if (!b.customer_id) continue;

      const { data: org } = await supabase
        .from("organizations")
        .select("name, timezone")
        .eq("id", b.org_id)
        .single();
      const { data: bay } = await supabase
        .from("bays")
        .select("name")
        .eq("id", b.bay_id)
        .single();
      const { data: profile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", b.customer_id)
        .single();

      const tz = org?.timezone ?? "America/New_York";
      const bayName = bay?.name ?? "Facility";
      const orgName = org?.name ?? "EZBooker";
      const timeStr = `${formatTimeInZone(b.start_time, tz)} – ${formatTimeInZone(b.end_time, tz)}`;
      const dateStr = new Date(b.date + "T12:00:00").toLocaleDateString(
        "en-US",
        { weekday: "short", month: "short", day: "numeric" }
      );

      await createNotification({
        orgId: b.org_id,
        recipientId: b.customer_id,
        recipientType: "customer",
        type: "booking_reminder_48hr",
        title: "Upcoming Booking Reminder",
        message: `Your booking at ${bayName} is in 2 days: ${dateStr}, ${timeStr}. Confirmation: ${b.confirmation_code}`,
        link: "/my-bookings",
        recipientEmail: profile?.email,
        recipientName: profile?.full_name ?? undefined,
        orgName,
        metadata: { confirmation_code: b.confirmation_code },
      });

      await supabase
        .from("bookings")
        .update({ reminder_48hr_sent_at: now.toISOString() })
        .eq("id", b.id);

      reminders48Sent++;
    }
  }

  // ── 24-hour cancellation window closed ─────────────────────
  // Query bookings starting in 0-48 hours (wide window for daily cron)
  const hour0 = now.toISOString();
  const hour48 = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  const { data: upcoming24 } = await supabase
    .from("bookings")
    .select(
      "id, org_id, customer_id, bay_id, date, start_time, end_time, confirmation_code"
    )
    .eq("status", "confirmed")
    .eq("is_guest", false)
    .is("cancel_window_notified_at", null)
    .gte("start_time", hour0)
    .lte("start_time", hour48);

  if (upcoming24 && upcoming24.length > 0) {
    for (const b of upcoming24) {
      if (!b.customer_id) continue;

      const { data: org } = await supabase
        .from("organizations")
        .select("name, timezone")
        .eq("id", b.org_id)
        .single();
      const { data: bay } = await supabase
        .from("bays")
        .select("name")
        .eq("id", b.bay_id)
        .single();
      const { data: profile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", b.customer_id)
        .single();

      const tz = org?.timezone ?? "America/New_York";
      const bayName = bay?.name ?? "Facility";
      const orgName = org?.name ?? "EZBooker";
      const timeStr = `${formatTimeInZone(b.start_time, tz)} – ${formatTimeInZone(b.end_time, tz)}`;
      const dateStr = new Date(b.date + "T12:00:00").toLocaleDateString(
        "en-US",
        { weekday: "short", month: "short", day: "numeric" }
      );

      await createNotification({
        orgId: b.org_id,
        recipientId: b.customer_id,
        recipientType: "customer",
        type: "cancellation_window_closed",
        title: "Cancellation Window Closed",
        message: `The free cancellation period for your booking has ended. ${bayName} — ${dateStr}, ${timeStr} (${b.confirmation_code})`,
        link: "/my-bookings",
        recipientEmail: profile?.email,
        recipientName: profile?.full_name ?? undefined,
        orgName,
        metadata: { confirmation_code: b.confirmation_code },
      });

      await supabase
        .from("bookings")
        .update({ cancel_window_notified_at: now.toISOString() })
        .eq("id", b.id);

      cancelWindowSent++;
    }
  }

  return NextResponse.json({
    message: "Booking reminders processed",
    reminders_48hr_sent: reminders48Sent,
    cancel_window_sent: cancelWindowSent,
  });
}
