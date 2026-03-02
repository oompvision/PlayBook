"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toast } from "@/components/ui/toast";
import { AuthModal } from "@/components/auth-modal";
import {
  CalendarIcon,
  Clock,
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
  LogIn,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────

type Bay = {
  id: string;
  name: string;
  resource_type: string | null;
};

type FacilityGroup = {
  id: string;
  name: string;
  description: string | null;
  bays: Bay[];
};

type AvailableSlot = {
  start_time: string;
  end_time: string;
  price_cents: number;
  bay_id: string;
  bay_name: string;
};

type ToastData = {
  message: string;
  description?: string;
};

type DynamicAvailabilityWidgetProps = {
  orgId: string;
  orgName: string;
  timezone: string;
  bays: Bay[];
  facilityGroups: FacilityGroup[];
  standaloneBays: Bay[];
  defaultDurations: number[];
  todayStr: string;
  minBookingLeadMinutes: number;
  bookableWindowDays: number;
  facilitySlug?: string;
  isAuthenticated?: boolean;
  userEmail?: string;
  userFullName?: string | null;
  userProfileId?: string;
  paymentMode?: string;
  cancellationWindowHours?: number;
};

// ─── Helpers ────────────────────────────────────────────────

const STORAGE_KEY = "playbook-dynamic-pending-booking";

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

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatDurationLong(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 60 === 0) {
    const hrs = minutes / 60;
    return `${hrs} hour${hrs > 1 ? "s" : ""}`;
  }
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}h ${mins}m`;
}

// ─── Component ──────────────────────────────────────────────

export function DynamicAvailabilityWidget(
  props: DynamicAvailabilityWidgetProps
) {
  const {
    orgId,
    orgName,
    timezone,
    bays,
    facilityGroups,
    standaloneBays,
    defaultDurations,
    todayStr,
    minBookingLeadMinutes,
    bookableWindowDays,
    facilitySlug,
    isAuthenticated = false,
    userEmail,
    userFullName,
    userProfileId,
    paymentMode = "none",
    cancellationWindowHours = 24,
  } = props;

  const router = useRouter();
  const requiresPayment = paymentMode !== "none";

  // Whether we need to show a facility/group picker
  const hasMultipleOptions =
    facilityGroups.length > 1 ||
    standaloneBays.length > 0 ||
    (facilityGroups.length === 1 && standaloneBays.length > 0);

  // ─── State ──────────────────────────────────────────────

  // Selection: group or standalone bay
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    !hasMultipleOptions && facilityGroups.length === 1
      ? facilityGroups[0].id
      : null
  );
  const [selectedBayId, setSelectedBayId] = useState<string | null>(
    !hasMultipleOptions && facilityGroups.length === 0 && standaloneBays.length === 1
      ? standaloneBays[0].id
      : null
  );

  // Date + duration + time
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [durations, setDurations] = useState<number[]>(defaultDurations);
  const [selectedDuration, setSelectedDuration] = useState<number>(
    defaultDurations[0] || 60
  );
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Selected time slot for booking
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);

  // Booking panel
  const [showBookingPanel, setShowBookingPanel] = useState(false);
  const [bookingNotes, setBookingNotes] = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);

  // Toast
  const [toast, setToast] = useState<ToastData | null>(null);

  // Calendar popover
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Max date
  const maxDate = addDays(todayStr, bookableWindowDays);

  // ─── Restore pending booking after auth ─────────────────

  useEffect(() => {
    if (isAuthenticated) {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const pending = JSON.parse(saved);
          if (pending.orgId === orgId) {
            setSelectedDate(pending.date || todayStr);
            setSelectedDuration(pending.duration || 60);
            if (pending.groupId) setSelectedGroupId(pending.groupId);
            if (pending.bayId) setSelectedBayId(pending.bayId);
            // Don't restore the slot — refetch availability
          }
        } catch {}
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [isAuthenticated, orgId, todayStr]);

  // ─── Fetch availability ─────────────────────────────────

  const fetchAvailability = useCallback(async () => {
    if (!selectedDate || !selectedDuration) return;

    // Need either a group or bay selected (or single-option auto-selected)
    const bayIdParam = selectedBayId;
    const groupIdParam = selectedGroupId;

    if (!bayIdParam && !groupIdParam) {
      // If all bays are in one group, we can still query all bays
      if (bays.length > 0 && !hasMultipleOptions) {
        // Fall through — will query all bays
      } else {
        setAvailableSlots([]);
        return;
      }
    }

    setLoadingSlots(true);
    setSelectedSlot(null);

    try {
      const params = new URLSearchParams({
        org_id: orgId,
        date: selectedDate,
        duration: String(selectedDuration),
      });

      if (bayIdParam) params.set("bay_id", bayIdParam);
      else if (groupIdParam) params.set("group_id", groupIdParam);

      const res = await fetch(`/api/availability?${params}`);
      if (!res.ok) {
        setAvailableSlots([]);
        return;
      }

      const data = await res.json();
      setAvailableSlots(data.slots || []);

      // Update durations if returned from API
      if (data.available_durations?.length > 0) {
        setDurations(data.available_durations);
      }
    } catch {
      setAvailableSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [
    orgId,
    selectedDate,
    selectedDuration,
    selectedBayId,
    selectedGroupId,
    bays.length,
    hasMultipleOptions,
  ]);

  useEffect(() => {
    fetchAvailability();
  }, [fetchAvailability]);

  // ─── Booking handlers ───────────────────────────────────

  function handleSelectSlot(slot: AvailableSlot) {
    setSelectedSlot(slot);
    setShowBookingPanel(true);
  }

  function handleCancelSelection() {
    setSelectedSlot(null);
    setShowBookingPanel(false);
    setBookingNotes("");
  }

  async function handleConfirmBooking() {
    if (!selectedSlot || !userProfileId) return;

    if (requiresPayment) {
      // TODO: Phase 5 — Stripe checkout integration
      setToast({
        message: "Payment required",
        description:
          "This facility requires payment. Stripe integration coming soon.",
      });
      return;
    }

    setBookingLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("create_dynamic_booking", {
        p_org_id: orgId,
        p_customer_id: userProfileId,
        p_bay_id: selectedSlot.bay_id,
        p_date: selectedDate,
        p_start_time: selectedSlot.start_time,
        p_end_time: selectedSlot.end_time,
        p_price_cents: selectedSlot.price_cents,
        p_notes: bookingNotes || null,
      });

      if (error) throw error;

      const result = data as {
        booking_id: string;
        confirmation_code: string;
        total_price_cents: number;
        start_time: string;
        end_time: string;
      };

      // Reset state
      handleCancelSelection();

      // Check if mobile
      const isMobile = window.innerWidth < 1024;
      if (isMobile) {
        router.push(
          `/my-bookings?success=true&codes=${result.confirmation_code}`
        );
        return;
      }

      // Desktop: show toast and refresh availability
      setToast({
        message: "Booking confirmed!",
        description: `Confirmation code: ${result.confirmation_code}`,
      });

      fetchAvailability();
    } catch (err) {
      setToast({
        message: "Booking failed",
        description:
          err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setBookingLoading(false);
    }
  }

  function handleAuthRequired() {
    // Save pending selection to localStorage
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        orgId,
        date: selectedDate,
        duration: selectedDuration,
        groupId: selectedGroupId,
        bayId: selectedBayId,
      })
    );
  }

  // ─── Date navigation ───────────────────────────────────

  function goToPrevDay() {
    if (selectedDate > todayStr) {
      setSelectedDate(addDays(selectedDate, -1));
    }
  }

  function goToNextDay() {
    if (selectedDate < maxDate) {
      setSelectedDate(addDays(selectedDate, 1));
    }
  }

  // ─── Render ─────────────────────────────────────────────

  const selectedOption = selectedGroupId
    ? facilityGroups.find((g) => g.id === selectedGroupId)?.name
    : selectedBayId
    ? bays.find((b) => b.id === selectedBayId)?.name
    : null;

  return (
    <div className="space-y-4">
      {/* Step 1: Facility/Group Picker (if needed) */}
      {hasMultipleOptions && (
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            What would you like to book?
          </p>
          <div className="flex flex-wrap gap-2">
            {facilityGroups.map((group) => (
              <button
                key={group.id}
                onClick={() => {
                  setSelectedGroupId(group.id);
                  setSelectedBayId(null);
                  setSelectedSlot(null);
                }}
                className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                  selectedGroupId === group.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-primary/50 hover:bg-accent"
                }`}
              >
                {group.name}
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ({group.bays.length})
                </span>
              </button>
            ))}
            {standaloneBays.map((bay) => (
              <button
                key={bay.id}
                onClick={() => {
                  setSelectedBayId(bay.id);
                  setSelectedGroupId(null);
                  setSelectedSlot(null);
                }}
                className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                  selectedBayId === bay.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-primary/50 hover:bg-accent"
                }`}
              >
                {bay.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Date + Duration */}
      <div className="rounded-xl border bg-card p-4 space-y-4">
        {/* Date picker row */}
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevDay}
            disabled={selectedDate <= todayStr}
            className="rounded-lg border p-2 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <button className="flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent">
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                {formatDateLabel(selectedDate)}
                {selectedDate === todayStr && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    Today
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="center">
              <Calendar
                mode="single"
                selected={new Date(selectedDate + "T12:00:00")}
                onSelect={(date) => {
                  if (date) {
                    const y = date.getFullYear();
                    const m = String(date.getMonth() + 1).padStart(2, "0");
                    const d = String(date.getDate()).padStart(2, "0");
                    setSelectedDate(`${y}-${m}-${d}`);
                    setCalendarOpen(false);
                  }
                }}
                disabled={(date) => {
                  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                  return dateStr < todayStr || dateStr > maxDate;
                }}
              />
            </PopoverContent>
          </Popover>

          <button
            onClick={goToNextDay}
            disabled={selectedDate >= maxDate}
            className="rounded-lg border p-2 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Duration chips */}
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Duration
          </p>
          <div className="flex flex-wrap gap-2">
            {durations.map((dur) => (
              <button
                key={dur}
                onClick={() => {
                  setSelectedDuration(dur);
                  setSelectedSlot(null);
                }}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                  selectedDuration === dur
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:border-primary/50 hover:bg-accent"
                }`}
              >
                {formatDuration(dur)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Step 3: Available Times */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">
            Available Times
            {selectedOption && (
              <span className="ml-1.5">
                &middot; {selectedOption}
              </span>
            )}
          </h3>
          {!loadingSlots && availableSlots.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {availableSlots.length} time{availableSlots.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {loadingSlots ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : availableSlots.length === 0 ? (
          <div className="py-12 text-center">
            <Clock className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              {!selectedGroupId && !selectedBayId && hasMultipleOptions
                ? "Select a facility to see available times"
                : "No availability for this date and duration"}
            </p>
            {selectedDate === todayStr && (
              <button
                onClick={() => setSelectedDate(addDays(todayStr, 1))}
                className="mt-2 text-sm font-medium text-primary hover:underline"
              >
                Try tomorrow
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {availableSlots.map((slot) => {
              const isSelected =
                selectedSlot?.start_time === slot.start_time;
              return (
                <button
                  key={slot.start_time}
                  onClick={() => handleSelectSlot(slot)}
                  className={`rounded-lg border px-3 py-3 text-center transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                      : "border-border hover:border-primary/50 hover:bg-accent"
                  }`}
                >
                  <div className="text-sm font-semibold">
                    {formatTime(slot.start_time, timezone)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    ${(slot.price_cents / 100).toFixed(2)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Booking CTA Bar (Portal) ─── */}
      {selectedSlot &&
        createPortal(
          <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {formatTime(selectedSlot.start_time, timezone)} &ndash;{" "}
                  {formatTime(selectedSlot.end_time, timezone)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateLabel(selectedDate)} &middot;{" "}
                  {formatDurationLong(selectedDuration)} &middot; $
                  {(selectedSlot.price_cents / 100).toFixed(2)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCancelSelection}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"
                >
                  <X className="h-5 w-5" />
                </button>
                {isAuthenticated ? (
                  <Button onClick={() => setShowBookingPanel(true)}>
                    Continue to Book
                  </Button>
                ) : (
                  <AuthModal
                    trigger={
                      <Button onClick={handleAuthRequired}>
                        <LogIn className="mr-2 h-4 w-4" />
                        Sign in to Book
                      </Button>
                    }
                  />
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ─── Inline Booking Panel ─── */}
      {showBookingPanel && selectedSlot && isAuthenticated && (
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Confirm Booking</h3>
            <button
              onClick={handleCancelSelection}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Summary */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Date</span>
              <span className="font-medium">{formatDateLabel(selectedDate)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Time</span>
              <span className="font-medium">
                {formatTime(selectedSlot.start_time, timezone)} &ndash;{" "}
                {formatTime(selectedSlot.end_time, timezone)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Duration</span>
              <span className="font-medium">
                {formatDurationLong(selectedDuration)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Facility</span>
              <span className="font-medium">{selectedSlot.bay_name}</span>
            </div>
            <div className="flex justify-between border-t pt-2 text-sm">
              <span className="font-medium">Total</span>
              <span className="text-lg font-bold">
                ${(selectedSlot.price_cents / 100).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Notes (optional)
            </label>
            <textarea
              value={bookingNotes}
              onChange={(e) => setBookingNotes(e.target.value)}
              placeholder="Any special requests..."
              rows={2}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Confirm */}
          <Button
            onClick={handleConfirmBooking}
            disabled={bookingLoading}
            className="w-full"
            size="lg"
          >
            {bookingLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {bookingLoading ? "Booking..." : "Confirm Booking"}
          </Button>

          {userEmail && (
            <p className="text-center text-xs text-muted-foreground">
              Booking as {userEmail}
            </p>
          )}
        </div>
      )}

      {/* ─── Toast ─── */}
      {toast && (
        <Toast
          message={toast.message}
          description={toast.description}
          onClose={() => setToast(null)}
        />
      )}

      {/* Spacer for CTA bar when a slot is selected */}
      {selectedSlot && <div className="h-20" />}
    </div>
  );
}
