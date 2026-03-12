"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  BookingDetailsModal,
  type BookingDetailData,
} from "@/components/booking-details-modal";
import {
  EventDetailsModal,
  type EventDetailData,
} from "@/components/event-details-modal";
import { formatTimeInZone, getVisualBookingStatus } from "@/lib/utils";

type ModifiedFromInfo = {
  startTime: string;
  endTime: string;
  date: string;
  bayName: string;
};

type Booking = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  total_price_cents: number;
  discount_cents?: number;
  discount_description?: string | null;
  status: string;
  confirmation_code: string;
  notes: string | null;
  bay_id: string;
  created_at: string;
  modified_from: string | null;
  modified_from_info?: ModifiedFromInfo | null;
  locationName?: string | null;
};

type EventReg = {
  id: string;
  event_id: string;
  status: string;
  waitlist_position: number | null;
  payment_status: string | null;
  registered_at: string;
  cancelled_at: string | null;
  promoted_at: string | null;
};

type EventData = {
  name: string;
  description: string | null;
  startTime: string;
  endTime: string;
  priceCents: number;
  capacity: number;
  registeredCount: number;
  bayNames: string;
};

export type FeedItemBooking = {
  kind: "booking";
  sortDate: string;
  booking: Booking;
};

export type FeedItemEvent = {
  kind: "event";
  sortDate: string;
  registration: EventReg;
  eventData: EventData;
};

export type FeedItem = FeedItemBooking | FeedItemEvent;

type Props = {
  upcoming: FeedItem[];
  past: FeedItem[];
  bayMap: Record<string, string>;
  timezone: string;
  orgId: string;
  initialBookingCode?: string | null;
  cancelAction: (formData: FormData) => Promise<void>;
  cancelEventAction: (formData: FormData) => Promise<void>;
  cancellationWindowHours?: number;
  paymentMode?: string;
};

function updateBookingUrl(code: string | null) {
  const url = new URL(window.location.href);
  if (code) {
    url.searchParams.set("booking", code);
  } else {
    url.searchParams.delete("booking");
  }
  window.history.replaceState(null, "", url.toString());
}

export function MyBookingsList({
  upcoming,
  past,
  bayMap,
  timezone,
  orgId,
  initialBookingCode,
  cancelAction,
  cancelEventAction,
  cancellationWindowHours = 24,
  paymentMode = "none",
}: Props) {
  const [selectedBooking, setSelectedBooking] =
    useState<BookingDetailData | null>(null);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventDetailData | null>(null);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [filterNotice, setFilterNotice] = useState<string | null>(null);
  const [autoOpenedCode, setAutoOpenedCode] = useState<string | null>(null);
  const [pastTab, setPastTab] = useState<"past" | "cancelled">("past");

  const allBookings = [...upcoming, ...past]
    .filter((item): item is FeedItemBooking => item.kind === "booking")
    .map((item) => item.booking);

  // Fetch a booking independently by confirmation code
  async function fetchBookingByCode(code: string): Promise<BookingDetailData | null> {
    const supabase = createClient();
    const { data: booking } = await supabase
      .from("bookings")
      .select(
        "id, date, start_time, end_time, total_price_cents, discount_cents, discount_description, status, confirmation_code, notes, bay_id, created_at, modified_from"
      )
      .eq("org_id", orgId)
      .eq("confirmation_code", code)
      .single();

    if (!booking) return null;

    let bayName = bayMap[booking.bay_id] ?? null;
    if (!bayName) {
      const { data: bay } = await supabase
        .from("bays")
        .select("name")
        .eq("id", booking.bay_id)
        .single();
      bayName = bay?.name ?? "Facility";
    }

    let modifiedFrom: ModifiedFromInfo | null = null;
    if (booking.modified_from) {
      const { data: original } = await supabase
        .from("bookings")
        .select("start_time, end_time, date, bay_id")
        .eq("id", booking.modified_from)
        .single();
      if (original) {
        let origBayName = bayMap[original.bay_id] ?? null;
        if (!origBayName) {
          const { data: origBay } = await supabase
            .from("bays")
            .select("name")
            .eq("id", original.bay_id)
            .single();
          origBayName = origBay?.name ?? "Facility";
        }
        modifiedFrom = {
          startTime: original.start_time,
          endTime: original.end_time,
          date: original.date,
          bayName: origBayName,
        };
      }
    }

    const isUpcoming = booking.status === "confirmed" && booking.date >= new Date().toISOString().slice(0, 10);

    return {
      id: booking.id,
      date: booking.date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      total_price_cents: booking.total_price_cents,
      discount_cents: booking.discount_cents || 0,
      discount_description: booking.discount_description || null,
      status: booking.status,
      confirmation_code: booking.confirmation_code,
      notes: booking.notes,
      created_at: booking.created_at,
      bayName,
      canCancel: isUpcoming,
      canModify: isUpcoming,
      modifiedFrom,
    };
  }

  // Auto-open booking from URL param
  useEffect(() => {
    if (!initialBookingCode) return;
    if (autoOpenedCode === initialBookingCode) return;
    setAutoOpenedCode(initialBookingCode);

    const found = allBookings.find(
      (b) => b.confirmation_code === initialBookingCode
    );
    if (found) {
      const isUpcoming = upcoming.some(
        (item) => item.kind === "booking" && item.booking.id === found.id
      );
      setSelectedBooking({
        id: found.id,
        date: found.date,
        start_time: found.start_time,
        end_time: found.end_time,
        total_price_cents: found.total_price_cents,
        discount_cents: found.discount_cents || 0,
        discount_description: found.discount_description || null,
        status: found.status,
        confirmation_code: found.confirmation_code,
        notes: found.notes,
        created_at: found.created_at,
        bayName: bayMap[found.bay_id] || "Facility",
        locationName: found.locationName,
        canCancel: isUpcoming,
        canModify: isUpcoming,
        modifiedFrom: found.modified_from_info || null,
      });
      setBookingModalOpen(true);
      return;
    }

    // Not found in current list — fetch independently
    fetchBookingByCode(initialBookingCode).then((data) => {
      if (data) {
        setFilterNotice(
          "Heads up — this booking was not found in your current bookings list."
        );
        setSelectedBooking(data);
        setBookingModalOpen(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBookingCode, autoOpenedCode]);

  function openBooking(booking: Booking, canCancel: boolean) {
    setSelectedBooking({
      id: booking.id,
      date: booking.date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      total_price_cents: booking.total_price_cents,
      discount_cents: booking.discount_cents || 0,
      discount_description: booking.discount_description || null,
      status: booking.status,
      confirmation_code: booking.confirmation_code,
      notes: booking.notes,
      created_at: booking.created_at,
      bayName: bayMap[booking.bay_id] || "Facility",
      locationName: booking.locationName,
      canCancel,
      canModify: canCancel,
      modifiedFrom: booking.modified_from_info || null,
    });
    setFilterNotice(null);
    setBookingModalOpen(true);
    updateBookingUrl(booking.confirmation_code);
  }

  function openEvent(reg: EventReg, eventData: EventData) {
    setSelectedEvent({
      registrationId: reg.id,
      eventId: reg.event_id,
      eventName: eventData.name,
      description: eventData.description,
      startTime: eventData.startTime,
      endTime: eventData.endTime,
      priceCents: eventData.priceCents,
      capacity: eventData.capacity,
      registeredCount: eventData.registeredCount,
      bayNames: eventData.bayNames,
      registrationStatus: reg.status,
      waitlistPosition: reg.waitlist_position,
      registeredAt: reg.registered_at,
    });
    setEventModalOpen(true);
  }

  function handleBookingOpenChange(open: boolean) {
    setBookingModalOpen(open);
    if (!open) {
      setFilterNotice(null);
      updateBookingUrl(null);
    }
  }

  function renderFeedItem(item: FeedItem, isUpcoming: boolean) {
    if (item.kind === "booking") {
      return renderBookingCard(item.booking, isUpcoming);
    }
    return renderEventCard(item, isUpcoming);
  }

  function renderBookingCard(booking: Booking, isUpcoming: boolean) {
    const d = new Date(booking.date + "T12:00:00");
    const dateStr = d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const timeStr = `${formatTimeInZone(booking.start_time, timezone)} – ${formatTimeInZone(booking.end_time, timezone)}`;
    const isCancelled = booking.status === "cancelled";
    const showPaid = paymentMode === "charge_upfront" && booking.status === "confirmed";

    if (isUpcoming) {
      const visualStatus = getVisualBookingStatus(booking.status, booking.start_time, booking.end_time);
      const isActive = visualStatus === "active";

      return (
        <button
          key={booking.id}
          type="button"
          onClick={() => openBooking(booking, true)}
          className="w-full rounded-lg border p-4 text-left hover-lift press-feedback hover:bg-muted/50"
        >
          <p className="font-medium">{dateStr}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {timeStr} · {bayMap[booking.bay_id] || "Facility"}
            {booking.locationName ? ` · ${booking.locationName}` : ""} · $
            {((booking.total_price_cents - (booking.discount_cents || 0)) / 100).toFixed(2)}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {booking.confirmation_code}
            </span>
            {isActive ? (
              <span className="inline-flex items-center rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                <span className="relative mr-1 flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                </span>
                Active
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Confirmed
              </span>
            )}
            {showPaid && (
              <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Paid
              </span>
            )}
          </div>
          {booking.modified_from_info && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400">
              <ArrowRight className="h-3 w-3" />
              Modified from{" "}
              <span className="font-semibold">
                {formatTimeInZone(booking.modified_from_info.startTime, timezone)} – {formatTimeInZone(booking.modified_from_info.endTime, timezone)},{" "}
                {new Date(booking.modified_from_info.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })},{" "}
                {booking.modified_from_info.bayName}
              </span>
            </p>
          )}
          {booking.notes && (
            <p className="mt-1 text-xs italic text-muted-foreground">
              {booking.notes}
            </p>
          )}
        </button>
      );
    }

    // Past / Cancelled booking
    return (
      <button
        key={booking.id}
        type="button"
        onClick={() => openBooking(booking, false)}
        className="w-full rounded-lg border p-4 text-left opacity-60 hover-lift press-feedback hover:bg-muted/50"
      >
        <p className={`font-medium ${isCancelled ? "text-muted-foreground" : ""}`}>{dateStr}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {timeStr} · {bayMap[booking.bay_id] || "Facility"}
          {booking.locationName ? ` · ${booking.locationName}` : ""} · $
          {((booking.total_price_cents - (booking.discount_cents || 0)) / 100).toFixed(2)}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {booking.confirmation_code}
          </span>
          {isCancelled ? (
            <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
              Cancelled
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              Completed
            </span>
          )}
        </div>
      </button>
    );
  }

  function renderEventCard(item: FeedItemEvent, isUpcoming: boolean) {
    const { registration: reg, eventData } = item;
    const dateStr = new Date(eventData.startTime).toLocaleDateString("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const timeStr = `${formatTimeInZone(eventData.startTime, timezone)} – ${formatTimeInZone(eventData.endTime, timezone)}`;

    const statusBadge = (() => {
      switch (reg.status) {
        case "confirmed":
          return <Badge className="bg-green-600 text-white hover:bg-green-600">Confirmed</Badge>;
        case "waitlisted":
          return (
            <Badge className="bg-blue-600 text-white hover:bg-blue-600">
              Waitlisted{reg.waitlist_position ? ` #${reg.waitlist_position}` : ""}
            </Badge>
          );
        case "pending_payment":
          return <Badge className="bg-amber-500 text-white hover:bg-amber-500">Payment Pending</Badge>;
        case "cancelled":
          return <Badge variant="secondary">Cancelled</Badge>;
        default:
          return <Badge variant="outline">{reg.status}</Badge>;
      }
    })();

    return (
      <button
        key={reg.id}
        type="button"
        onClick={() => openEvent(reg, eventData)}
        className={`w-full rounded-lg border p-4 text-left hover-lift press-feedback hover:bg-muted/50 ${!isUpcoming ? "opacity-60" : ""}`}
      >
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{dateStr}</p>
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400">
              Event
            </Badge>
            {statusBadge}
          </div>
          <p className="mt-1 font-semibold">{eventData.name}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {timeStr}
            {eventData.bayNames ? ` · ${eventData.bayNames}` : ""}
            {eventData.priceCents > 0
              ? ` · $${(eventData.priceCents / 100).toFixed(2)}`
              : " · Free"}
          </p>
        </div>
      </button>
    );
  }

  const hasUpcoming = upcoming.length > 0;

  // Split past into completed vs cancelled
  const pastCompleted = past.filter((item) => {
    if (item.kind === "booking") return item.booking.status !== "cancelled";
    return item.registration.status !== "cancelled";
  });
  const pastCancelled = past.filter((item) => {
    if (item.kind === "booking") return item.booking.status === "cancelled";
    return item.registration.status === "cancelled";
  });

  // Sort both: most recent first (closest to now)
  const sortDesc = (a: FeedItem, b: FeedItem) =>
    new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime();
  const sortedPastCompleted = [...pastCompleted].sort(sortDesc);
  const sortedPastCancelled = [...pastCancelled].sort(sortDesc);

  const hasPastOrCancelled = pastCompleted.length > 0 || pastCancelled.length > 0;
  const activePastItems = pastTab === "past" ? sortedPastCompleted : sortedPastCancelled;

  return (
    <>
      {/* Upcoming */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold">Upcoming</h2>
        {!hasUpcoming && (
          <p className="mt-4 py-8 text-center text-muted-foreground">
            No upcoming bookings or events.{" "}
            <Link href="/" className="text-primary hover:underline">
              Book a session
            </Link>
          </p>
        )}
        <div className="mt-3 space-y-2">
          {upcoming.map((item) => (
            <div key={item.kind === "booking" ? item.booking.id : item.registration.id}>
              {renderFeedItem(item, true)}
            </div>
          ))}
        </div>
      </div>

      {/* Past / Cancelled tabs */}
      {hasPastOrCancelled && (
        <div className="mt-8">
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            <button
              onClick={() => setPastTab("past")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                pastTab === "past"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Past{pastCompleted.length > 0 ? ` (${pastCompleted.length})` : ""}
            </button>
            <button
              onClick={() => setPastTab("cancelled")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                pastTab === "cancelled"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Cancelled{pastCancelled.length > 0 ? ` (${pastCancelled.length})` : ""}
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {activePastItems.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                {pastTab === "past" ? "No past bookings." : "No cancelled bookings."}
              </p>
            ) : (
              activePastItems.map((item) => (
                <div key={item.kind === "booking" ? item.booking.id : item.registration.id}>
                  {renderFeedItem(item, false)}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <BookingDetailsModal
        booking={selectedBooking}
        variant="customer"
        timezone={timezone}
        open={bookingModalOpen}
        onOpenChange={handleBookingOpenChange}
        cancelAction={cancelAction}
        notice={filterNotice}
        cancellationWindowHours={cancellationWindowHours}
        paymentMode={paymentMode}
      />

      <EventDetailsModal
        event={selectedEvent}
        timezone={timezone}
        open={eventModalOpen}
        onOpenChange={setEventModalOpen}
        cancelAction={cancelEventAction}
      />
    </>
  );
}
