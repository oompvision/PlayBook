"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Calendar, ArrowRight, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import {
  BookingDetailsModal,
  type BookingDetailData,
} from "@/components/booking-details-modal";
import {
  EventDetailsModal,
  type EventDetailData,
} from "@/components/event-details-modal";

type Booking = {
  id: string;
  confirmation_code: string;
  bay_id: string;
  date: string;
  start_time: string;
  end_time: string;
  total_price_cents: number;
  discount_cents: number | null;
  discount_description: string | null;
  status: string;
  notes: string | null;
  location_id: string | null;
  locationName: string | null;
};

type Bay = {
  id: string;
  name: string;
};

type RawEventReg = {
  id: string;
  event_id: string;
  status: string;
  waitlist_position: number | null;
  registered_at: string;
  discount_cents: number;
  discount_description: string | null;
  events: {
    name: string;
    description: string | null;
    start_time: string;
    end_time: string;
    price_cents: number;
    capacity: number;
    registered_count: number;
    event_bays: { bay_id: string; bays: { name: string } | null }[];
  } | null;
};

type EventReg = {
  id: string;
  event_id: string;
  status: string;
  waitlist_position: number | null;
  registered_at: string;
  discount_cents: number;
  discount_description: string | null;
  event: {
    name: string;
    description: string | null;
    start_time: string;
    end_time: string;
    price_cents: number;
    capacity: number;
    registered_count: number;
    event_bays: { bay_id: string; bays: { name: string } | null }[];
  };
};

type FeedItem =
  | { kind: "booking"; sortDate: string; booking: Booking }
  | { kind: "event"; sortDate: string; reg: EventReg };

function formatTime(timestamp: string, timezone: string) {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatItemDate(dateStr: string, timezone: string, isTimestamp: boolean): string {
  const d = isTimestamp ? new Date(dateStr) : new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    timeZone: isTimestamp ? timezone : undefined,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ─── Booking Card ──────────────────────────────────────────────────────────

function BookingCard({
  booking,
  bays,
  timezone,
  onClick,
}: {
  booking: Booking;
  bays: Bay[];
  timezone: string;
  onClick: () => void;
}) {
  const bayName = bays.find((b) => b.id === booking.bay_id)?.name ?? "Unknown";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg px-4 py-3 text-left transition-colors hover:bg-muted/50"
    >
      <p className="text-sm font-semibold">
        {formatItemDate(booking.date, timezone, false)}
      </p>
      <p className="mt-0.5 text-sm font-medium">
        {formatTime(booking.start_time, timezone)}&ndash;{formatTime(booking.end_time, timezone)}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{bayName}</p>
    </button>
  );
}

// ─── Event Card ────────────────────────────────────────────────────────────

function EventCard({
  reg,
  timezone,
  onClick,
}: {
  reg: EventReg;
  timezone: string;
  onClick: () => void;
}) {
  const evt = reg.event;
  const bayNames =
    evt.event_bays
      ?.map((eb) => eb.bays?.name)
      .filter(Boolean)
      .join(", ") || "TBD";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg px-4 py-3 text-left transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{evt.name}</p>
        <span className="inline-flex items-center rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-medium text-white dark:bg-gray-100 dark:text-gray-900">
          Event
        </span>
      </div>
      <p className="mt-0.5 text-sm">
        {formatItemDate(evt.start_time, timezone, true)}
      </p>
      <p className="mt-0.5 text-sm font-medium">
        {formatTime(evt.start_time, timezone)}&ndash;{formatTime(evt.end_time, timezone)}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{bayNames}</p>
    </button>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export function MyBookingsDropdown({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [eventRegs, setEventRegs] = useState<EventReg[]>([]);
  const [bays, setBays] = useState<Bay[]>([]);
  const [timezone, setTimezone] = useState("America/New_York");
  const [cancellationWindowHours, setCancellationWindowHours] = useState(24);
  const [paymentMode, setPaymentMode] = useState("none");
  const router = useRouter();

  // Booking detail modal
  const [selectedBooking, setSelectedBooking] = useState<BookingDetailData | null>(null);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);

  // Event detail modal
  const [selectedEvent, setSelectedEvent] = useState<EventDetailData | null>(null);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [cancelToast, setCancelToast] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const todayStr = new Date().toISOString().slice(0, 10);

    const [orgResult, baysResult, bookingsResult, eventRegsResult] = await Promise.all([
      supabase
        .from("organizations")
        .select("timezone, cancellation_window_hours")
        .eq("id", orgId)
        .single(),
      supabase
        .from("bays")
        .select("id, name")
        .eq("org_id", orgId)
        .eq("is_active", true),
      supabase
        .from("bookings")
        .select("id, confirmation_code, bay_id, date, start_time, end_time, total_price_cents, discount_cents, discount_description, status, notes, location_id, locations:location_id(name)")
        .eq("org_id", orgId)
        .eq("status", "confirmed")
        .gte("date", todayStr)
        .order("date")
        .order("start_time"),
      supabase
        .from("event_registrations")
        .select(`
          id, event_id, status, waitlist_position, registered_at, discount_cents, discount_description,
          events:event_id (
            name, description, start_time, end_time, price_cents, capacity,
            registered_count,
            event_bays (bay_id, bays:bay_id (name))
          )
        `)
        .eq("org_id", orgId)
        .in("status", ["confirmed", "waitlisted", "pending_payment"]),
    ]);

    if (orgResult.data) {
      setTimezone(orgResult.data.timezone || "America/New_York");
      setCancellationWindowHours(orgResult.data.cancellation_window_hours ?? 24);
    }
    setBays(baysResult.data || []);
    setBookings(
      (bookingsResult.data || []).map((b: any) => ({
        ...b,
        locationName: (b.locations as any)?.name ?? null,
      }))
    );

    // Process event regs - map `events` (Supabase join name) to `event`, filter to upcoming
    const now = new Date().toISOString();
    const rawRegs = (eventRegsResult.data || []) as unknown as RawEventReg[];
    const regs: EventReg[] = rawRegs
      .filter((r) => r.events && r.events.start_time > now)
      .map((r) => ({
        id: r.id,
        event_id: r.event_id,
        status: r.status,
        waitlist_position: r.waitlist_position,
        registered_at: r.registered_at,
        discount_cents: r.discount_cents || 0,
        discount_description: r.discount_description || null,
        event: r.events!,
      }))
      .sort((a, b) => a.event.start_time.localeCompare(b.event.start_time));
    setEventRegs(regs);

    // Fetch payment mode
    const { data: paySettings } = await supabase
      .from("org_payment_settings")
      .select("payment_mode")
      .eq("org_id", orgId)
      .single();
    if (paySettings?.payment_mode) setPaymentMode(paySettings.payment_mode);

    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  // Build sorted feed items (chronological, max 3: 1 next + 2 upcoming)
  const allItems: FeedItem[] = [];
  for (const booking of bookings) {
    allItems.push({ kind: "booking", sortDate: booking.start_time, booking });
  }
  for (const reg of eventRegs) {
    allItems.push({ kind: "event", sortDate: reg.event.start_time, reg });
  }
  allItems.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

  const nextItem = allItems[0] ?? null;
  const upcomingItems = allItems.slice(1, 3);

  function openBookingDetail(booking: Booking) {
    const bayName = bays.find((b) => b.id === booking.bay_id)?.name ?? "Unknown Bay";
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
      created_at: "",
      bayName,
      locationName: booking.locationName,
    });
    setBookingModalOpen(true);
    setOpen(false);
  }

  function openEventDetail(reg: EventReg) {
    const bayNames = reg.event.event_bays
      ?.map((eb) => eb.bays?.name)
      .filter(Boolean)
      .join(", ") || "TBD";
    setSelectedEvent({
      registrationId: reg.id,
      eventId: reg.event_id,
      eventName: reg.event.name,
      description: reg.event.description,
      startTime: reg.event.start_time,
      endTime: reg.event.end_time,
      priceCents: reg.event.price_cents,
      discountCents: reg.discount_cents || 0,
      discountDescription: reg.discount_description || null,
      capacity: reg.event.capacity,
      registeredCount: reg.event.registered_count ?? 0,
      bayNames,
      registrationStatus: reg.status,
      waitlistPosition: reg.waitlist_position,
      registeredAt: reg.registered_at,
    });
    setEventModalOpen(true);
    setOpen(false);
  }

  function handleItemClick(item: FeedItem) {
    if (item.kind === "booking") openBookingDetail(item.booking);
    else openEventDetail(item.reg);
  }

  async function handleCancelBooking(formData: FormData) {
    const bookingId = formData.get("bookingId") as string;
    if (!bookingId) return;
    const supabase = createClient();
    await supabase.rpc("cancel_booking", { p_booking_id: bookingId });
    fetchData();
    router.refresh();
  }

  async function handleCancelEvent() {
    if (!selectedEvent) return;
    const supabase = createClient();
    await supabase
      .from("event_registrations")
      .update({ status: "cancelled" })
      .eq("id", selectedEvent.registrationId);
    fetchData();
    router.refresh();
  }

  function renderItem(item: FeedItem) {
    if (item.kind === "booking") {
      return (
        <BookingCard
          key={`b-${item.booking.id}`}
          booking={item.booking}
          bays={bays}
          timezone={timezone}
          onClick={() => handleItemClick(item)}
        />
      );
    }
    return (
      <EventCard
        key={`e-${item.reg.id}`}
        reg={item.reg}
        timezone={timezone}
        onClick={() => handleItemClick(item)}
      />
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Upcoming bookings"
          >
            <Calendar className="h-5 w-5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="flex max-h-[min(28rem,var(--radix-popover-content-available-height,28rem))] flex-col">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : allItems.length === 0 ? (
              /* ── Empty state ─────────────────────────────── */
              <div className="flex flex-col items-center px-4 py-8 text-center">
                <Calendar className="mb-3 h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm font-medium text-muted-foreground">
                  No upcoming bookings
                </p>
                <Link
                  href="/"
                  onClick={() => setOpen(false)}
                  className="mt-3"
                >
                  <Button size="sm">Book Now</Button>
                </Link>
                <Link
                  href="/my-bookings"
                  onClick={() => setOpen(false)}
                  className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  View Past Bookings
                </Link>
              </div>
            ) : (
              /* ── Feed ────────────────────────────────────── */
              <div>
                {/* Next Booking */}
                {nextItem && (
                  <div className="border-b">
                    <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Next Booking
                    </p>
                    {renderItem(nextItem)}
                  </div>
                )}

                {/* Upcoming */}
                {upcomingItems.length > 0 && (
                  <div className="border-b">
                    <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Upcoming
                    </p>
                    {upcomingItems.map(renderItem)}
                  </div>
                )}

                {/* Footer link */}
                <div className="px-4 py-3">
                  <Link
                    href="/my-bookings"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-1 text-sm font-medium hover:text-primary"
                  >
                    View All Bookings
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Booking Details Modal */}
      <BookingDetailsModal
        booking={selectedBooking}
        variant="customer"
        timezone={timezone}
        open={bookingModalOpen}
        onOpenChange={(isOpen) => {
          setBookingModalOpen(isOpen);
          if (!isOpen) setSelectedBooking(null);
        }}
        cancelAction={handleCancelBooking}
        onCancelComplete={() => setCancelToast("Booking cancelled.")}
        cancellationWindowHours={cancellationWindowHours}
        paymentMode={paymentMode}
      />

      {/* Event Details Modal */}
      <EventDetailsModal
        event={selectedEvent}
        timezone={timezone}
        open={eventModalOpen}
        onOpenChange={(isOpen) => {
          setEventModalOpen(isOpen);
          if (!isOpen) setSelectedEvent(null);
        }}
        onCancelClient={handleCancelEvent}
        onCancelComplete={(name) => setCancelToast(`You have unregistered from ${name}.`)}
        cancellationWindowHours={cancellationWindowHours}
        paymentMode={paymentMode}
      />

      {cancelToast && (
        <Toast
          message={cancelToast}
          duration={5000}
          onClose={() => setCancelToast(null)}
        />
      )}
    </>
  );
}
