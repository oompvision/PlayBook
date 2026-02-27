import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  createNotification,
  notifyOrgAdmins,
  sendGuestEmail,
} from "@/lib/notifications";
import { formatTimeInZone } from "@/lib/utils";

type BookingAction = "confirmed" | "canceled" | "modified";

/**
 * POST /api/notifications/booking
 * Fire-and-forget endpoint called by client after successful booking RPC.
 * Sends notifications to both customer and org admin(s).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action: BookingAction;
      bookingId?: string;
      confirmationCode?: string;
      orgId: string;
      oldConfirmationCode?: string;
    };

    const { action, bookingId, confirmationCode, orgId, oldConfirmationCode } =
      body;

    if (!action || !orgId) {
      return NextResponse.json({ error: "Missing action or orgId" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Look up the booking
    let bookingQuery = supabase
      .from("bookings")
      .select(
        "id, org_id, customer_id, bay_id, date, start_time, end_time, total_price_cents, status, confirmation_code, is_guest, guest_name, guest_email, notes, claim_token"
      )
      .eq("org_id", orgId);

    if (bookingId) {
      bookingQuery = bookingQuery.eq("id", bookingId);
    } else if (confirmationCode) {
      bookingQuery = bookingQuery.eq("confirmation_code", confirmationCode);
    } else {
      return NextResponse.json({ error: "Need bookingId or confirmationCode" }, { status: 400 });
    }

    const { data: booking } = await bookingQuery.single();
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // Get org info
    const { data: org } = await supabase
      .from("organizations")
      .select("name, timezone")
      .eq("id", orgId)
      .single();

    const orgName = org?.name ?? "EZBooker";
    const tz = org?.timezone ?? "America/New_York";

    // Get bay name
    const { data: bay } = await supabase
      .from("bays")
      .select("name")
      .eq("id", booking.bay_id)
      .single();

    const bayName = bay?.name ?? "Facility";

    // Format time details
    const timeStr = `${formatTimeInZone(booking.start_time, tz)} – ${formatTimeInZone(booking.end_time, tz)}`;
    const dateStr = new Date(booking.date + "T12:00:00").toLocaleDateString(
      "en-US",
      { weekday: "short", month: "short", day: "numeric" }
    );
    const priceStr = `$${(booking.total_price_cents / 100).toFixed(2)}`;

    // Get customer info (if not guest)
    let customerName = "Guest";
    let customerEmail: string | undefined;
    if (booking.customer_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", booking.customer_id)
        .single();
      if (profile) {
        customerName = profile.full_name || profile.email;
        customerEmail = profile.email;
      }
    } else if (booking.is_guest) {
      customerName = booking.guest_name || "Guest";
      customerEmail = booking.guest_email ?? undefined;
    }

    const code = booking.confirmation_code;

    if (action === "confirmed") {
      const bookingDetails = `${bayName} — ${dateStr}, ${timeStr}\nConfirmation: ${code}\nTotal: ${priceStr}`;

      // Customer notification
      if (booking.customer_id) {
        await createNotification({
          orgId,
          recipientId: booking.customer_id,
          recipientType: "customer",
          type: "booking_confirmed",
          title: "Booking Confirmed",
          message: bookingDetails,
          link: "/my-bookings",
          recipientEmail: customerEmail,
          recipientName: customerName,
          orgName,
          metadata: { confirmation_code: code, bay: bayName },
        });
      } else if (booking.is_guest && booking.guest_email) {
        // Guest: send email only (no in-app notification)
        const claimLink = booking.claim_token
          ? `\n\nSign up to manage your booking online:\n${process.env.NEXT_PUBLIC_SITE_URL || "https://ezbooker.app"}/auth/signup?claim=${booking.claim_token}`
          : "\n\nCreate an EZBooker account to manage your bookings online.";

        await sendGuestEmail({
          to: booking.guest_email,
          toName: booking.guest_name ?? undefined,
          subject: `Booking Confirmed — ${orgName}`,
          body: `Your booking has been confirmed!\n\n${bookingDetails}${claimLink}`,
          orgName,
        });

        // Admin notification for guest booking
        await notifyOrgAdmins(orgId, orgName, {
          type: "guest_booking_created",
          title: `Guest Booking: ${code}`,
          message: `Guest invitation sent to ${booking.guest_email} for ${bayName} — ${dateStr}, ${timeStr}`,
          link: `/admin/bookings?q=${code}`,
          metadata: { confirmation_code: code, guest_email: booking.guest_email },
        });
      }

      // Admin notification
      await notifyOrgAdmins(orgId, orgName, {
        type: "booking_confirmed",
        title: `New Booking: ${code}`,
        message: `${customerName} booked ${bayName} — ${dateStr}, ${timeStr} (${priceStr})`,
        link: `/admin/bookings?q=${code}`,
        metadata: { confirmation_code: code, customer: customerName },
      });
    } else if (action === "canceled") {
      // Customer notification
      if (booking.customer_id) {
        await createNotification({
          orgId,
          recipientId: booking.customer_id,
          recipientType: "customer",
          type: "booking_canceled",
          title: "Booking Cancelled",
          message: `Your booking ${code} (${bayName}, ${dateStr}, ${timeStr}) has been cancelled.`,
          link: "/my-bookings",
          recipientEmail: customerEmail,
          recipientName: customerName,
          orgName,
          metadata: { confirmation_code: code },
        });
      }

      // Admin notification
      await notifyOrgAdmins(orgId, orgName, {
        type: "booking_canceled",
        title: `Booking Cancelled: ${code}`,
        message: `${customerName} cancelled ${bayName} — ${dateStr}, ${timeStr}`,
        link: `/admin/bookings?q=${code}`,
        metadata: { confirmation_code: code, customer: customerName },
      });
    } else if (action === "modified") {
      // For modifications, include old booking info if available
      let oldDetails = "";
      if (oldConfirmationCode) {
        const { data: oldBooking } = await supabase
          .from("bookings")
          .select("bay_id, date, start_time, end_time, confirmation_code")
          .eq("confirmation_code", oldConfirmationCode)
          .single();

        if (oldBooking) {
          const oldBay = await supabase
            .from("bays")
            .select("name")
            .eq("id", oldBooking.bay_id)
            .single();
          const oldBayName = oldBay.data?.name ?? "Facility";
          const oldTimeStr = `${formatTimeInZone(oldBooking.start_time, tz)} – ${formatTimeInZone(oldBooking.end_time, tz)}`;
          const oldDateStr = new Date(
            oldBooking.date + "T12:00:00"
          ).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          });
          oldDetails = `Previous: ${oldBayName} — ${oldDateStr}, ${oldTimeStr} (${oldConfirmationCode})\n`;
        }
      }

      const newDetails = `New: ${bayName} — ${dateStr}, ${timeStr} (${code})`;

      // Customer notification
      if (booking.customer_id) {
        await createNotification({
          orgId,
          recipientId: booking.customer_id,
          recipientType: "customer",
          type: "booking_modified",
          title: "Booking Modified",
          message: `${oldDetails}${newDetails}`,
          link: "/my-bookings",
          recipientEmail: customerEmail,
          recipientName: customerName,
          orgName,
          metadata: {
            confirmation_code: code,
            old_confirmation_code: oldConfirmationCode,
          },
        });
      }

      // Admin notification
      await notifyOrgAdmins(orgId, orgName, {
        type: "booking_modified",
        title: `Booking Modified: ${code}`,
        message: `${customerName}: ${oldDetails}${newDetails}`,
        link: `/admin/bookings?q=${code}`,
        metadata: {
          confirmation_code: code,
          old_confirmation_code: oldConfirmationCode,
          customer: customerName,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[notifications/booking] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
