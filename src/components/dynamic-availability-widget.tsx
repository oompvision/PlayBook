"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  StripeCheckoutWrapper,
  CheckoutForm,
  type CheckoutFormHandle,
} from "@/components/checkout-form";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuthModal } from "@/components/auth-modal";
import {
  CalendarIcon,
  CalendarCheck,
  Clock,
  CreditCard,
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
  LogIn,
  ArrowRight,
  ArrowLeft,
  MapPin,
  Check,
  ShieldCheck,
  AlertTriangle,
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

type CheckoutIntent = {
  client_secret: string;
  intent_type: "payment" | "setup";
  intent_id: string;
  stripe_customer_id: string;
  stripe_account_id: string;
  amount_cents: number;
  cancellation_policy_text: string;
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
  const [bookingError, setBookingError] = useState("");

  // Multi-step wizard state (for payment flow)
  const [bookingStep, setBookingStep] = useState<1 | 2 | 3>(1);

  // Stripe payment state
  const checkoutFormRef = useRef<CheckoutFormHandle | null>(null);
  const [checkoutIntent, setCheckoutIntent] = useState<CheckoutIntent | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [paymentValidated, setPaymentValidated] = useState(false);
  const [paymentValidationError, setPaymentValidationError] = useState("");
  const [confirmedPaymentMethodId, setConfirmedPaymentMethodId] = useState<string | null>(null);
  const [cardBrand, setCardBrand] = useState<string | null>(null);
  const [cardLast4, setCardLast4] = useState<string | null>(null);
  const [policyAgreed, setPolicyAgreed] = useState(false);
  const [policyAgreedAt, setPolicyAgreedAt] = useState<string | null>(null);
  const [confirmPolicyModalOpen, setConfirmPolicyModalOpen] = useState(false);

  // Toast
  const [toast, setToast] = useState<ToastData | null>(null);

  // Calendar popover
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Max date
  const maxDate = addDays(todayStr, bookableWindowDays);

  // Check if booking is within cancellation window
  const isWithinCancellationWindow = selectedSlot
    ? new Date(selectedSlot.start_time).getTime() - Date.now() <
      cancellationWindowHours * 60 * 60 * 1000
    : false;

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
          }
        } catch {}
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [isAuthenticated, orgId, todayStr]);

  // ─── Fetch availability ─────────────────────────────────

  const fetchAvailability = useCallback(async () => {
    if (!selectedDate || !selectedDuration) return;

    const bayIdParam = selectedBayId;
    const groupIdParam = selectedGroupId;

    if (!bayIdParam && !groupIdParam) {
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

  // ─── Stripe: Create checkout intent ─────────────────────

  async function createCheckoutIntent() {
    if (!selectedSlot) return;

    setCheckoutLoading(true);
    setCheckoutError("");

    try {
      const res = await fetch("/api/stripe/create-checkout-intent-dynamic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price_cents: selectedSlot.price_cents }),
      });

      if (!res.ok) {
        const err = await res.json();
        setCheckoutError(err.error || "Failed to prepare payment");
        setCheckoutLoading(false);
        return;
      }

      const data = await res.json();
      setCheckoutIntent(data);
    } catch {
      setCheckoutError("Network error. Please try again.");
    } finally {
      setCheckoutLoading(false);
    }
  }

  // ─── Stripe: Record booking payment ─────────────────────

  async function recordBookingPayment(
    bookingId: string,
    paymentMethodId?: string
  ) {
    if (!checkoutIntent) return;
    try {
      await fetch("/api/stripe/record-booking-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: bookingId,
          intent_id: checkoutIntent.intent_id,
          intent_type: checkoutIntent.intent_type,
          stripe_customer_id: checkoutIntent.stripe_customer_id,
          stripe_payment_method_id: paymentMethodId,
          amount_cents: checkoutIntent.amount_cents,
          cancellation_policy_text: checkoutIntent.cancellation_policy_text,
          policy_agreed_at: policyAgreedAt,
        }),
      });
    } catch {
      console.error("Failed to record booking payment");
    }
  }

  // ─── Stripe: Cancel/refund intent ───────────────────────

  async function cancelIntent() {
    if (!checkoutIntent) return;
    try {
      await fetch("/api/stripe/cancel-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent_id: checkoutIntent.intent_id,
          intent_type: checkoutIntent.intent_type,
        }),
      });
    } catch {
      console.error("Failed to cancel intent");
    }
  }

  // ─── Reset payment state ────────────────────────────────

  function resetPaymentState() {
    setCheckoutIntent(null);
    setCheckoutLoading(false);
    setCheckoutError("");
    setPaymentValidated(false);
    setPaymentValidationError("");
    setConfirmedPaymentMethodId(null);
    setCardBrand(null);
    setCardLast4(null);
    setPolicyAgreed(false);
    setPolicyAgreedAt(null);
    setBookingStep(1);
    setBookingError("");
  }

  // ─── Booking handlers ───────────────────────────────────

  function handleSelectSlot(slot: AvailableSlot) {
    setSelectedSlot(slot);
    setShowBookingPanel(true);
    resetPaymentState();
  }

  function handleCancelSelection() {
    setSelectedSlot(null);
    setShowBookingPanel(false);
    setBookingNotes("");
    resetPaymentState();
  }

  async function handleConfirmBooking() {
    if (!selectedSlot || !userProfileId) return;

    setBookingLoading(true);
    setBookingError("");

    // If payment is required, use the confirmed payment method from step 2
    let paymentMethodId: string | undefined;
    if (requiresPayment && checkoutIntent) {
      if (!policyAgreedAt) {
        setPolicyAgreed(true);
        setPolicyAgreedAt(new Date().toISOString());
      }

      if (confirmedPaymentMethodId) {
        paymentMethodId = confirmedPaymentMethodId;
      } else {
        // Fallback: confirm payment now
        if (!checkoutFormRef.current) {
          setBookingError("Payment form not ready. Please try again.");
          setBookingLoading(false);
          return;
        }
        const result = await checkoutFormRef.current.submit();
        if (!result.success) {
          setBookingError(result.error || "Payment failed. Please try again.");
          setBookingLoading(false);
          return;
        }
        paymentMethodId = result.paymentMethodId;
      }
    }

    try {
      const res = await fetch("/api/bookings/dynamic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_id: orgId,
          bay_id: selectedGroupId ? undefined : selectedSlot.bay_id,
          group_id: selectedGroupId || undefined,
          date: selectedDate,
          start_time: selectedSlot.start_time,
          end_time: selectedSlot.end_time,
          price_cents: selectedSlot.price_cents,
          notes: bookingNotes || null,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        // Booking failed — cancel/refund payment if applicable
        if (requiresPayment && checkoutIntent) {
          await cancelIntent();
          resetPaymentState();
        }
        const msg = result.error || "Booking failed";
        setBookingError(
          msg + (requiresPayment ? " Your payment has been cancelled." : "")
        );
        setBookingLoading(false);
        fetchAvailability();
        return;
      }

      // Record booking payment (fire-and-forget)
      if (requiresPayment && checkoutIntent) {
        recordBookingPayment(result.booking_id, paymentMethodId);
      }

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
      const bayInfo = result.bay_name ? ` — ${result.bay_name}` : "";
      setToast({
        message: "Booking confirmed!",
        description: `Confirmation code: ${result.confirmation_code}${bayInfo}`,
      });

      fetchAvailability();
    } catch (err) {
      // Booking failed after payment — cancel/refund
      if (requiresPayment && checkoutIntent) {
        await cancelIntent();
        resetPaymentState();
      }
      setBookingError(
        (err instanceof Error ? err.message : "Please try again") +
        (requiresPayment ? " Your payment has been refunded." : "")
      );
    } finally {
      setBookingLoading(false);
    }
  }

  function handleAuthRequired() {
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

  const totalSteps = requiresPayment ? 3 : 2;
  const stepLabels = requiresPayment
    ? ["Booking Details", "Payment Method", "Confirm Booking"]
    : ["Booking Details", "Confirm Booking"];

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
        !showBookingPanel &&
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

      {/* ─── Inline Booking Panel (Multi-Step Wizard) ─── */}
      {showBookingPanel && selectedSlot && isAuthenticated && (
        <div className="rounded-xl border bg-card p-6 space-y-4">
          {/* Panel header with step indicator */}
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">
                  {bookingStep === 1
                    ? "Booking Details"
                    : bookingStep === 2 && requiresPayment
                    ? "Payment Method"
                    : "Confirm Booking"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {formatShortDate(selectedDate)} &middot;{" "}
                  {formatTime(selectedSlot.start_time, timezone)} &ndash;{" "}
                  {formatTime(selectedSlot.end_time, timezone)}
                </p>
              </div>
              <button
                onClick={handleCancelSelection}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Step indicator */}
            <div className="mt-3 flex items-center gap-1">
              {stepLabels.map((label, i) => {
                const stepNum = i + 1;
                const isCurrent = bookingStep === stepNum;
                const isCompleted = bookingStep > stepNum;
                const canNavigate =
                  isCompleted && !(confirmedPaymentMethodId && stepNum === 2);
                return (
                  <div key={label} className="flex items-center gap-1">
                    {i > 0 && (
                      <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                    )}
                    <button
                      type="button"
                      disabled={!canNavigate}
                      onClick={() => {
                        if (!canNavigate) return;
                        if (
                          stepNum === 1 &&
                          requiresPayment &&
                          confirmedPaymentMethodId
                        ) {
                          resetPaymentState();
                        }
                        setBookingStep(stepNum as 1 | 2 | 3);
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        isCurrent
                          ? "bg-primary text-primary-foreground"
                          : isCompleted && canNavigate
                          ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20"
                          : isCompleted
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isCompleted ? (
                        <Check
                          className="h-3 w-3 text-green-600"
                          strokeWidth={3}
                        />
                      ) : (
                        <span>{stepNum}</span>
                      )}
                      {label}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Error banner */}
          {bookingError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {bookingError}
            </div>
          )}

          {/* ═══ Step 1: Booking Details ═══ */}
          {bookingStep === 1 && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-medium">
                    {formatDateLabel(selectedDate)}
                  </span>
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

              {/* User info */}
              <p className="text-sm text-muted-foreground">
                Booking as {userFullName || userEmail}
              </p>

              {/* Continue button */}
              <Button
                className="w-full"
                size="lg"
                onClick={() => {
                  setBookingError("");
                  if (requiresPayment) {
                    setBookingStep(2);
                    setPaymentValidationError("");
                    if (!checkoutIntent && !checkoutLoading) {
                      createCheckoutIntent();
                    }
                  } else {
                    // No payment — skip directly to confirm step
                    setBookingStep(2);
                  }
                }}
              >
                {requiresPayment ? (
                  <>
                    Continue to Payment
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                ) : (
                  <>
                    Continue to Confirm
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          )}

          {/* ═══ Step 2: Payment (only when requiresPayment) ═══ */}
          {/* Stripe Elements must stay mounted across steps 2 & 3 so submit() works on confirm */}
          {requiresPayment && (bookingStep === 2 || bookingStep === 3) && (
            <div className={bookingStep !== 2 ? "hidden" : ""}>
              {checkoutLoading ? (
                <div className="flex items-center justify-center rounded-lg border border-dashed py-12">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Preparing payment...
                  </span>
                </div>
              ) : checkoutError ? (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {checkoutError}
                  <button
                    className="ml-2 underline"
                    onClick={createCheckoutIntent}
                  >
                    Retry
                  </button>
                </div>
              ) : checkoutIntent ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      {paymentMode === "charge_upfront"
                        ? "Payment Details"
                        : "Card on File"}
                    </p>
                  </div>

                  <StripeCheckoutWrapper
                    stripeAccountId={checkoutIntent.stripe_account_id}
                    clientSecret={checkoutIntent.client_secret}
                  >
                    <CheckoutForm
                      ref={checkoutFormRef}
                      intentType={checkoutIntent.intent_type}
                    />
                  </StripeCheckoutWrapper>

                  {paymentValidationError && (
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                      {paymentValidationError}
                    </div>
                  )}
                </div>
              ) : null}

              {/* Navigation buttons */}
              <div className="mt-6 flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setBookingStep(1);
                    setPaymentValidationError("");
                  }}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button
                  className="flex-1"
                  disabled={!checkoutIntent || checkoutLoading}
                  onClick={async () => {
                    setPaymentValidationError("");
                    if (!checkoutFormRef.current) {
                      setPaymentValidationError(
                        "Payment form not ready. Please try again."
                      );
                      return;
                    }
                    // Confirm payment and extract card info
                    const result =
                      await checkoutFormRef.current.confirmAndGetCardInfo();
                    if (!result.success) {
                      setPaymentValidationError(
                        result.error || "Please check your payment details."
                      );
                      return;
                    }
                    setPaymentValidated(true);
                    if (result.paymentMethodId)
                      setConfirmedPaymentMethodId(result.paymentMethodId);

                    // Get card brand + last4
                    let brand = result.cardBrand;
                    let last4 = result.cardLast4;

                    if (result.paymentMethodId && (!brand || !last4)) {
                      try {
                        const res = await fetch(
                          `/api/stripe/card-details?pm=${result.paymentMethodId}`
                        );
                        if (res.ok) {
                          const data = await res.json();
                          brand = data.brand || brand;
                          last4 = data.last4 || last4;
                        }
                      } catch {
                        // Non-critical
                      }
                    }

                    if (brand) setCardBrand(brand);
                    if (last4) setCardLast4(last4);

                    // Implicit policy agreement
                    if (!policyAgreedAt) {
                      setPolicyAgreed(true);
                      setPolicyAgreedAt(new Date().toISOString());
                    }
                    setBookingStep(3);
                  }}
                >
                  Continue to Confirm
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ═══ Confirm Step (Step 2 no-payment / Step 3 with payment) ═══ */}
          {((bookingStep === 2 && !requiresPayment) ||
            (bookingStep === 3 && requiresPayment)) && (
            <div>
              {/* Summary card */}
              <div className="mb-4 space-y-3 rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm">
                  <CalendarCheck className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {formatShortDate(selectedDate)}
                    {" · "}
                    {formatTime(selectedSlot.start_time, timezone)} &ndash;{" "}
                    {formatTime(selectedSlot.end_time, timezone)}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{selectedSlot.bay_name}</span>
                </div>

                {requiresPayment && paymentValidated && (
                  <div className="flex items-center gap-2 text-sm">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    <span>
                      {cardBrand && cardLast4
                        ? `${cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1)} •••• ${cardLast4}`
                        : "Payment method confirmed"}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between border-t pt-3 text-sm font-bold">
                  <span>Total</span>
                  <span>
                    ${(selectedSlot.price_cents / 100).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Notes (if provided) */}
              {bookingNotes && (
                <div className="mb-4 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Note:</span>{" "}
                  {bookingNotes}
                </div>
              )}

              {/* Terms + cancellation policy */}
              <p className="mb-2 text-center text-xs text-muted-foreground">
                By booking you agree to the terms and{" "}
                {checkoutIntent?.cancellation_policy_text ? (
                  <button
                    type="button"
                    onClick={() => setConfirmPolicyModalOpen(true)}
                    className="underline underline-offset-2 transition-colors hover:text-foreground"
                  >
                    cancellation policy
                  </button>
                ) : (
                  "cancellation policy"
                )}
              </p>

              {/* Cancellation policy modal */}
              {checkoutIntent?.cancellation_policy_text && (
                <Dialog
                  open={confirmPolicyModalOpen}
                  onOpenChange={setConfirmPolicyModalOpen}
                >
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        Cancellation Policy
                      </DialogTitle>
                    </DialogHeader>
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/50">
                      <p className="text-sm leading-relaxed text-blue-700 dark:text-blue-300">
                        {checkoutIntent.cancellation_policy_text}
                      </p>
                    </div>
                  </DialogContent>
                </Dialog>
              )}

              {/* No-cancellation window warning */}
              {isWithinCancellationWindow && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/50">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                    Booking is less than {cancellationWindowHours}h away and
                    cannot be refunded or modified.
                  </p>
                </div>
              )}

              {/* Navigation + Confirm */}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setBookingStep(1);
                    if (requiresPayment) {
                      resetPaymentState();
                    }
                  }}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button
                  className="flex-1"
                  size="lg"
                  disabled={bookingLoading}
                  onClick={handleConfirmBooking}
                >
                  {bookingLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {requiresPayment && paymentMode === "charge_upfront"
                        ? "Processing payment..."
                        : requiresPayment
                        ? "Saving card..."
                        : "Booking..."}
                    </>
                  ) : requiresPayment && paymentMode === "charge_upfront" ? (
                    `Confirm & Pay $${(selectedSlot.price_cents / 100).toFixed(2)}`
                  ) : requiresPayment ? (
                    "Confirm & Save Card"
                  ) : (
                    "Confirm Booking"
                  )}
                </Button>
              </div>
            </div>
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
      {selectedSlot && !showBookingPanel && <div className="h-20" />}
    </div>
  );
}
