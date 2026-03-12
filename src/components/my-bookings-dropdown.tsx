"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarCheck, ArrowUpRight, Loader2, Crown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  BookingDetailsModal,
  type BookingDetailData,
} from "@/components/booking-details-modal";
import {
  EventDetailsModal,
  type EventDetailData,
} from "@/components/event-details-modal";
import { formatPrice } from "@/lib/utils";

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

type SidebarItem =
  | { kind: "booking"; sortDate: string; booking: Booking }
  | { kind: "event"; sortDate: string; reg: EventReg };

function formatTime(timestamp: string, timezone: string) {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBookingDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

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
          id, event_id, status, waitlist_position, registered_at,
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

  // Build sorted sidebar items
  const sidebarItems: SidebarItem[] = [];
  for (const booking of bookings) {
    sidebarItems.push({ kind: "booking", sortDate: booking.start_time, booking });
  }
  for (const reg of eventRegs) {
    sidebarItems.push({ kind: "event", sortDate: reg.event.start_time, reg });
  }
  sidebarItems.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

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

  async function handleCancelBooking(formData: FormData) {
    const bookingId = formData.get("bookingId") as string;
    if (!bookingId) return;
    const supabase = createClient();
    await supabase.rpc("cancel_booking", { p_booking_id: bookingId });
    setBookingModalOpen(false);
    setSelectedBooking(null);
    // Refresh data
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
    setEventModalOpen(false);
    setSelectedEvent(null);
    fetchData();
    router.refresh();
  }

  const count = sidebarItems.length;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="relative">
            My Bookings
            {count > 0 && !open && (
              <span className="ml-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                {count > 99 ? "99+" : count}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="flex max-h-[min(28rem,var(--radix-popover-content-available-height,28rem))] flex-col">
            {/* Header */}
            <div className="shrink-0 border-b px-4 py-3">
              <Link
                href="/my-bookings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-1 text-sm font-semibold hover:text-primary"
              >
                View All Bookings
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">Upcoming</p>
            </div>

            {/* List */}
            <ScrollArea className="min-h-0 flex-1">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : sidebarItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CalendarCheck className="mb-2 h-8 w-8 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground">No upcoming bookings</p>
                </div>
              ) : (
                <div className="divide-y">
                  {sidebarItems.map((item) => {
                    if (item.kind === "booking") {
                      const booking = item.booking;
                      const bayName = bays.find((b) => b.id === booking.bay_id)?.name ?? "Unknown Bay";
                      const discount = booking.discount_cents || 0;
                      const total = booking.total_price_cents - discount;
                      const showPaid = paymentMode === "charge_upfront" && booking.status === "confirmed";

                      return (
                        <button
                          type="button"
                          key={`b-${booking.id}`}
                          onClick={() => openBookingDetail(booking)}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium">
                                {formatBookingDate(booking.date)} &middot;{" "}
                                {formatTime(booking.start_time, timezone)} &ndash;{" "}
                                {formatTime(booking.end_time, timezone)}
                              </p>
                              <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {bayName}
                              {booking.locationName ? ` · ${booking.locationName}` : ""}
                            </p>
                            {discount > 0 ? (
                              <p className="mt-0.5 text-xs">
                                <span className="text-muted-foreground line-through">{formatPrice(booking.total_price_cents)}</span>
                                <span className="ml-1 font-semibold text-teal-600 dark:text-teal-400">
                                  <Crown className="mr-0.5 inline h-3 w-3" /> {formatPrice(total)}
                                </span>
                              </p>
                            ) : (
                              <p className="mt-0.5 text-xs font-semibold">{formatPrice(total)}</p>
                            )}
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {booking.confirmation_code}
                              </span>
                              <span className="inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                Confirmed
                              </span>
                              {showPaid && (
                                <span className="inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                  Paid
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    }

                    // Event registration
                    const reg = item.reg;
                    const evt = reg.event;
                    const eventDateStr = new Date(evt.start_time).toLocaleDateString("en-US", {
                      timeZone: timezone,
                      month: "short",
                      day: "numeric",
                    });

                    return (
                      <button
                        type="button"
                        key={`e-${reg.id}`}
                        onClick={() => openEventDetail(reg)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                              Event
                            </span>
                            <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
                          </div>
                          <p className="mt-1 text-sm font-medium">{evt.name}</p>
                          <div className="mt-1 flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">
                              {eventDateStr} &middot;{" "}
                              {formatTime(evt.start_time, timezone)} &ndash;{" "}
                              {formatTime(evt.end_time, timezone)}
                            </p>
                            <span className="text-xs font-semibold">
                              {evt.price_cents > 0 ? formatPrice(evt.price_cents) : "Free"}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
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
      />
    </>
  );
}
