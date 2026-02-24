"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CalendarIcon,
  CalendarCheck,
  Clock,
  Loader2,
  ArrowRight,
  MessageSquare,
  LogIn,
} from "lucide-react";
import { ChatWidget } from "@/components/chat/chat-widget";
import { AuthModal } from "@/components/auth-modal";

type Bay = {
  id: string;
  name: string;
  resource_type: string | null;
};

type Slot = {
  id: string;
  start_time: string;
  end_time: string;
  price_cents: number;
  status: string;
  bay_id: string;
};

type Booking = {
  id: string;
  confirmation_code: string;
  bay_id: string;
  date: string;
  start_time: string;
  end_time: string;
  total_price_cents: number;
  status: string;
  notes: string | null;
};

type AvailabilityWidgetProps = {
  orgId: string;
  orgName: string;
  timezone: string;
  bays: Bay[];
  todayStr: string;
  minBookingLeadMinutes: number;
  facilitySlug?: string;
  isAuthenticated?: boolean;
};

function formatTime(timestamp: string, timezone: string) {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
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

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

/**
 * Build a timezone-aware ISO timestamp (duplicated from lib/utils to avoid
 * importing server-only code into a client component).
 */
function toTimestamp(date: string, time: string, timezone: string): string {
  const naive = new Date(`${date}T${time}`);
  const utcParts = getDateParts(naive, "UTC");
  const tzParts = getDateParts(naive, timezone);

  const utcDate = new Date(
    Date.UTC(utcParts.year, utcParts.month - 1, utcParts.day, utcParts.hour, utcParts.minute)
  );
  const tzAsUtc = new Date(
    Date.UTC(tzParts.year, tzParts.month - 1, tzParts.day, tzParts.hour, tzParts.minute)
  );

  const offsetMs = tzAsUtc.getTime() - utcDate.getTime();
  const offsetMinutes = offsetMs / 60000;
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absMinutes / 60)).padStart(2, "0");
  const offsetMins = String(absMinutes % 60).padStart(2, "0");

  return `${date}T${time}${sign}${offsetHours}:${offsetMins}`;
}

function getDateParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") === 24 ? 0 : get("hour"),
    minute: get("minute"),
  };
}

export function AvailabilityWidget({
  orgId,
  orgName,
  timezone,
  bays,
  todayStr,
  minBookingLeadMinutes,
  facilitySlug,
  isAuthenticated,
}: AvailabilityWidgetProps) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [selectedBayId, setSelectedBayId] = useState(bays[0]?.id ?? "");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotCountsByBay, setSlotCountsByBay] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string>>(new Set());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [autoAdvancedFrom, setAutoAdvancedFrom] = useState<string | null>(null);
  const [chatExpanded, setChatExpanded] = useState(true);

  // Bookings state
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch upcoming confirmed bookings for the current user
  useEffect(() => {
    if (!isAuthenticated) return;

    async function fetchBookings() {
      setBookingsLoading(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("bookings")
        .select("id, confirmation_code, bay_id, date, start_time, end_time, total_price_cents, status, notes")
        .eq("org_id", orgId)
        .eq("status", "confirmed")
        .gte("date", todayStr)
        .order("date")
        .order("start_time");
      setBookings(data || []);
      setBookingsLoading(false);
    }

    fetchBookings();
  }, [isAuthenticated, orgId, todayStr]);

  // On initial mount, check if today has availability. If not, jump to the next date that does.
  useEffect(() => {
    async function checkAndAutoAdvance() {
      const supabase = createClient();

      // Compute effective start for today (now + lead time)
      let effectiveStart: string;
      if (minBookingLeadMinutes > 0) {
        const cutoff = new Date(Date.now() + minBookingLeadMinutes * 60_000);
        effectiveStart = cutoff.toISOString();
      } else {
        effectiveStart = toTimestamp(todayStr, "00:00:00", timezone);
      }

      const todayEnd = toTimestamp(addDays(todayStr, 1), "00:00:00", timezone);

      // Quick count: does today have any available slots?
      const { count } = await supabase
        .from("bay_schedule_slots")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "available")
        .gte("start_time", effectiveStart)
        .lt("start_time", todayEnd);

      if (count && count > 0) return; // Today has availability, stay put

      // Find the earliest future available slot
      const { data: nextSlot } = await supabase
        .from("bay_schedule_slots")
        .select("start_time")
        .eq("org_id", orgId)
        .eq("status", "available")
        .gte("start_time", todayEnd)
        .order("start_time")
        .limit(1)
        .single();

      if (nextSlot) {
        // Extract the date in the facility timezone
        const nextDate = new Date(nextSlot.start_time).toLocaleDateString(
          "en-CA",
          { timeZone: timezone }
        );
        setAutoAdvancedFrom(todayStr);
        setSelectedDate(nextDate);
      }
    }

    checkAndAutoAdvance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isToday = selectedDate === todayStr;
  const canGoBack = selectedDate > todayStr;

  // Fetch all available slot counts for all bays on the selected date,
  // plus the detailed slots for the selected bay
  const fetchSlots = useCallback(
    async (date: string, bayId: string) => {
      setLoading(true);
      setSelectedSlotIds(new Set());

      const supabase = createClient();

      // Compute day boundaries in the facility timezone
      const nextDayStr = addDays(date, 1);
      const dayStart = toTimestamp(date, "00:00:00", timezone);
      const dayEnd = toTimestamp(nextDayStr, "00:00:00", timezone);

      // For today, exclude slots starting within the lead time window
      let effectiveStart = dayStart;
      if (date === todayStr && minBookingLeadMinutes > 0) {
        const cutoff = new Date(Date.now() + minBookingLeadMinutes * 60_000);
        effectiveStart = cutoff.toISOString();
      }

      // Fetch all available slots for the date across all bays
      const { data: allSlots } = await supabase
        .from("bay_schedule_slots")
        .select("id, start_time, end_time, price_cents, status, bay_schedule_id")
        .eq("org_id", orgId)
        .eq("status", "available")
        .gte("start_time", effectiveStart)
        .lt("start_time", dayEnd)
        .order("start_time");

      // Fetch bay_schedule records to map slots to bays
      const { data: schedules } = await supabase
        .from("bay_schedules")
        .select("id, bay_id")
        .eq("org_id", orgId)
        .eq("date", date);

      const scheduleToBay: Record<string, string> = {};
      if (schedules) {
        for (const s of schedules) {
          scheduleToBay[s.id] = s.bay_id;
        }
      }

      // Count slots per bay and build detailed slot list for selected bay
      const counts: Record<string, number> = {};
      const baySlots: Slot[] = [];

      if (allSlots) {
        for (const slot of allSlots) {
          const slotBayId = scheduleToBay[slot.bay_schedule_id];
          if (!slotBayId) continue;

          counts[slotBayId] = (counts[slotBayId] || 0) + 1;

          if (slotBayId === bayId) {
            baySlots.push({
              id: slot.id,
              start_time: slot.start_time,
              end_time: slot.end_time,
              price_cents: slot.price_cents,
              status: slot.status,
              bay_id: slotBayId,
            });
          }
        }
      }

      setSlotCountsByBay(counts);
      setSlots(baySlots);
      setLoading(false);
    },
    [orgId, timezone, todayStr, minBookingLeadMinutes]
  );

  useEffect(() => {
    if (selectedBayId) {
      fetchSlots(selectedDate, selectedBayId);
    }
  }, [selectedDate, selectedBayId, fetchSlots]);

  function handleDateChange(delta: number) {
    const newDate = addDays(selectedDate, delta);
    if (newDate < todayStr) return;
    setSelectedDate(newDate);
    setAutoAdvancedFrom(null);
  }

  function handleCalendarSelect(date: Date | undefined) {
    if (!date) return;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const newDate = `${y}-${m}-${d}`;
    if (newDate < todayStr) return;
    setSelectedDate(newDate);
    setCalendarOpen(false);
    setAutoAdvancedFrom(null);
  }

  function toggleSlot(slotId: string) {
    setSelectedSlotIds((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) {
        next.delete(slotId);
      } else {
        next.add(slotId);
      }
      return next;
    });
  }

  function handleContinue() {
    const params = new URLSearchParams();
    params.set("date", selectedDate);
    params.append("bay", selectedBayId);
    params.append(
      `slots_${selectedBayId}`,
      Array.from(selectedSlotIds).join(",")
    );
    router.push(`/book/confirm?${params.toString()}`);
  }

  async function handleCancelBooking(bookingId: string) {
    setCancellingId(bookingId);
    const supabase = createClient();
    const { error } = await supabase.rpc("cancel_booking", { p_booking_id: bookingId });
    if (!error) {
      setBookings((prev) => prev.filter((b) => b.id !== bookingId));
      setExpandedBookingId(null);
      // Refresh slots in case cancellation freed up availability
      fetchSlots(selectedDate, selectedBayId);
    }
    setCancellingId(null);
  }

  // Calculate totals
  const totalCents = slots
    .filter((s) => selectedSlotIds.has(s.id))
    .reduce((sum, s) => sum + s.price_cents, 0);

  const selectedBay = bays.find((b) => b.id === selectedBayId);

  return (
    <div className="flex items-start gap-6">
      {/* ===== Sidebar — Confirmed Bookings + Chat Assistant (desktop only) ===== */}
      <div className="sticky top-[4.5rem] hidden w-72 shrink-0 flex-col rounded-xl border bg-card shadow-sm lg:flex max-h-[calc(100vh-5.5rem)]">
        {/* Bookings section — scrollable */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isAuthenticated ? (
            <div className="p-3">
              <div className="mb-3 flex items-center gap-2 px-1">
                <CalendarCheck className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Confirmed Bookings</h3>
              </div>
              {bookingsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : bookings.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <CalendarCheck className="h-8 w-8 text-muted-foreground/20" />
                  <p className="text-xs text-muted-foreground">
                    No upcoming bookings
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {bookings.map((booking) => {
                    const isExpanded = expandedBookingId === booking.id;
                    const bayName =
                      bays.find((b) => b.id === booking.bay_id)?.name ??
                      "Unknown Bay";
                    const price = `$${(booking.total_price_cents / 100).toFixed(2)}`;
                    const isCancelling = cancellingId === booking.id;

                    return (
                      <div
                        key={booking.id}
                        className="rounded-lg border bg-background transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedBookingId(
                              isExpanded ? null : booking.id
                            )
                          }
                          className="flex w-full flex-col gap-1 p-3 text-left"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {booking.confirmation_code}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="h-3 w-3 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            )}
                          </div>
                          <p className="text-sm font-medium">{bayName}</p>
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">
                              {formatBookingDate(booking.date)} &middot;{" "}
                              {formatTime(booking.start_time, timezone)}{" "}
                              &ndash;{" "}
                              {formatTime(booking.end_time, timezone)}
                            </p>
                            <span className="text-xs font-semibold">
                              {price}
                            </span>
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="border-t px-3 py-2.5">
                            {booking.notes && (
                              <p className="mb-2 text-xs text-muted-foreground">
                                {booking.notes}
                              </p>
                            )}
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 w-full text-xs"
                              disabled={isCancelling}
                              onClick={() =>
                                handleCancelBooking(booking.id)
                              }
                            >
                              {isCancelling ? (
                                <>
                                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                  Cancelling...
                                </>
                              ) : (
                                "Cancel Booking"
                              )}
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <LogIn className="h-8 w-8 text-muted-foreground/20" />
              <div>
                <p className="text-sm font-medium">Your Bookings</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sign in to see your confirmed bookings
                </p>
              </div>
              <AuthModal
                trigger={
                  <Button variant="outline" size="sm" className="gap-2">
                    <LogIn className="h-3.5 w-3.5" />
                    Sign In
                  </Button>
                }
              />
            </div>
          )}
        </div>

        {/* Chat Assistant — pinned to bottom of sidebar */}
        {facilitySlug && (
          <div className="shrink-0 border-t">
            <button
              type="button"
              onClick={() => setChatExpanded((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="flex-1">Availability Assistant</span>
              {chatExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </button>
            {chatExpanded && (
              <div className="h-[28rem] px-2 pb-2">
                <ChatWidget
                  facilitySlug={facilitySlug}
                  orgName={orgName}
                  mode="sidebar"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== Main content ===== */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* Horizontal Bay Tabs — scrollable */}
        <div className="border-b">
          <div className="flex gap-2 overflow-x-auto px-4 py-3">
            {bays.map((bay) => {
              const count = slotCountsByBay[bay.id] || 0;
              const isActive = bay.id === selectedBayId;

              return (
                <button
                  key={bay.id}
                  type="button"
                  onClick={() => setSelectedBayId(bay.id)}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <span>{bay.name}</span>
                  {bay.resource_type && (
                    <span
                      className={`text-xs ${
                        isActive
                          ? "text-primary-foreground/70"
                          : ""
                      }`}
                    >
                      &middot; {bay.resource_type}
                    </span>
                  )}
                  <Badge
                    variant={isActive ? "secondary" : "outline"}
                    className={`text-xs ${
                      isActive ? "" : count === 0 ? "opacity-50" : ""
                    }`}
                  >
                    {loading ? "..." : count}
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>

        {/* Date Navigation Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={!canGoBack}
              onClick={() => handleDateChange(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => handleDateChange(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="ml-1">
              <p className="text-sm font-semibold">
                {formatDateLabel(selectedDate)}
              </p>
              {isToday && (
                <p className="text-xs text-muted-foreground">Today</p>
              )}
            </div>
          </div>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <CalendarIcon className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {formatShortDate(selectedDate)}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={new Date(selectedDate + "T12:00:00")}
                onSelect={handleCalendarSelect}
                disabled={{ before: new Date(todayStr + "T12:00:00") }}
                startMonth={new Date(todayStr + "T12:00:00")}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Auto-advance banner */}
        {autoAdvancedFrom && (
          <div className="border-b bg-amber-50 px-5 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            No availability today &mdash; showing{" "}
            <span className="font-medium">{formatDateLabel(selectedDate)}</span>
          </div>
        )}

        {/* Slot List */}
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : slots.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Clock className="mb-3 h-10 w-10 text-muted-foreground/30" />
              <p className="font-medium text-muted-foreground">
                No available slots
              </p>
              <p className="mt-1 text-sm text-muted-foreground/70">
                {selectedBay?.name} has no availability on{" "}
                {formatShortDate(selectedDate)}. Try another date or facility.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {slots.map((slot) => {
                const startTime = formatTime(slot.start_time, timezone);
                const endTime = formatTime(slot.end_time, timezone);
                const price = `$${(slot.price_cents / 100).toFixed(2)}`;
                const isSelected = selectedSlotIds.has(slot.id);

                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => toggleSlot(slot.id)}
                    className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "hover:border-foreground/20 hover:bg-accent"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-full ${
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <Clock className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {startTime} &ndash; {endTime}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {selectedBay?.name}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold">{price}</span>
                      <div
                        className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
                          isSelected
                            ? "border-primary bg-primary"
                            : "border-muted-foreground/30"
                        }`}
                      >
                        {isSelected && (
                          <svg
                            className="h-3 w-3 text-primary-foreground"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Fixed booking bar overlay — portalled to body so it's always visible */}
      {selectedSlotIds.size > 0 &&
        mounted &&
        createPortal(
          <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-6">
              <div>
                <p className="text-sm font-medium">
                  {selectedSlotIds.size} slot
                  {selectedSlotIds.size !== 1 ? "s" : ""} selected
                </p>
                <p className="text-xs text-muted-foreground">
                  Total: ${(totalCents / 100).toFixed(2)}
                </p>
              </div>
              <Button onClick={handleContinue} className="gap-2">
                Continue to Book
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
