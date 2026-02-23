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
  CalendarIcon,
  Clock,
  Loader2,
  ArrowRight,
} from "lucide-react";

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

type AvailabilityWidgetProps = {
  orgId: string;
  orgName: string;
  timezone: string;
  bays: Bay[];
  todayStr: string;
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

  useEffect(() => {
    setMounted(true);
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

      // Fetch all available slots for the date across all bays
      const { data: allSlots } = await supabase
        .from("bay_schedule_slots")
        .select("id, start_time, end_time, price_cents, status, bay_schedule_id")
        .eq("org_id", orgId)
        .eq("status", "available")
        .gte("start_time", dayStart)
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
    [orgId, timezone]
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

  // Calculate totals
  const totalCents = slots
    .filter((s) => selectedSlotIds.has(s.id))
    .reduce((sum, s) => sum + s.price_cents, 0);

  const selectedBay = bays.find((b) => b.id === selectedBayId);

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex min-h-[480px]">
        {/* Bay Sidebar */}
        <div className="w-56 shrink-0 border-r bg-muted/30">
          <div className="border-b px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Facilities
            </p>
          </div>
          <nav className="p-2">
            {bays.map((bay) => {
              const count = slotCountsByBay[bay.id] || 0;
              const isActive = bay.id === selectedBayId;

              return (
                <button
                  key={bay.id}
                  type="button"
                  onClick={() => setSelectedBayId(bay.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  <div className="min-w-0">
                    <p className={`truncate font-medium ${isActive ? "" : ""}`}>
                      {bay.name}
                    </p>
                    {bay.resource_type && (
                      <p
                        className={`truncate text-xs ${
                          isActive
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground"
                        }`}
                      >
                        {bay.resource_type}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant={isActive ? "secondary" : "outline"}
                    className={`ml-2 shrink-0 text-xs ${
                      isActive ? "" : count === 0 ? "opacity-50" : ""
                    }`}
                  >
                    {loading ? "..." : count}
                  </Badge>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex flex-1 flex-col">
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
                  disabled={(date) => {
                    const d = new Date(date);
                    d.setHours(12, 0, 0, 0);
                    const todayDate = new Date(todayStr + "T12:00:00");
                    return d < todayDate;
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Slot List */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="flex h-full items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : slots.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center py-16 text-center">
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
