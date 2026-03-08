"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  StripeCheckoutWrapper,
  CheckoutForm,
  type CheckoutFormHandle,
} from "@/components/checkout-form";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toast } from "@/components/ui/toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChatWidget, type BookingAction } from "@/components/chat/chat-widget";
import {
  BookingDetailsModal,
  type BookingDetailData,
} from "@/components/booking-details-modal";
import { LocationSwitcher } from "@/components/location-switcher";
import { EventRegistrationPanel, type EventForPanel } from "@/components/events/event-registration-panel";
import {
  CalendarIcon,
  CalendarCheck,
  CalendarDays,
  Clock,
  CreditCard,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X,
  ArrowRight,
  ArrowLeft,
  ArrowUpRight,
  ExternalLink,
  MapPin,
  LogIn,
  Check,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Crown,
  Users,
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

type DayEvent = {
  id: string;
  name: string;
  description: string | null;
  start_time: string;
  end_time: string;
  capacity: number;
  price_cents: number;
  members_only: boolean;
  bay_names: string[];
  registered_count: number;
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

type MembershipContext = {
  isMember: boolean;
  effectiveWindowDays: number;
  guestWindowDays: number;
  memberWindowDays: number;
  discountType: "flat" | "percent" | null;
  discountValue: number;
  tierName: string | null;
  membershipEnabled: boolean;
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
  locationId?: string | null;
  locations?: Array<{ id: string; name: string; is_default: boolean; address: string | null }>;
  locationsEnabled?: boolean;
  membership?: MembershipContext;
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
    locationId,
    locations = [],
    locationsEnabled = false,
    membership,
  } = props;

  // Membership discount calculation
  const memberDiscount = membership?.isMember && membership.discountType && membership.discountValue
    ? membership
    : null;

  function calcDiscount(priceCents: number): { discountCents: number; finalCents: number; label: string } {
    if (!memberDiscount) return { discountCents: 0, finalCents: priceCents, label: "" };
    let discountCents: number;
    let label: string;
    if (memberDiscount.discountType === "percent") {
      discountCents = Math.round(priceCents * memberDiscount.discountValue / 100);
      label = `${memberDiscount.discountValue}% member discount`;
    } else {
      discountCents = Math.min(memberDiscount.discountValue * 100, priceCents);
      label = `$${memberDiscount.discountValue.toFixed(2)} member discount`;
    }
    return { discountCents, finalCents: priceCents - discountCents, label };
  }

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

  // Booking panel (portal-based bottom-up overlay)
  const [panelOpen, setPanelOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [bookingNotes, setBookingNotes] = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState("");

  // Inline auth state
  const [authTab, setAuthTab] = useState<string>("signin");
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState("");
  const [signInLoading, setSignInLoading] = useState(false);
  const [signUpName, setSignUpName] = useState("");
  const [signUpPhone, setSignUpPhone] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpError, setSignUpError] = useState("");
  const [signUpLoading, setSignUpLoading] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);

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

  // Events for the selected date/facility
  const [dayEvents, setDayEvents] = useState<DayEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedEventForPanel, setSelectedEventForPanel] = useState<EventForPanel | null>(null);

  // Sidebar: confirmed bookings + chat
  const [chatExpanded, setChatExpanded] = useState(false);
  const pendingBookingAction = useRef<BookingAction | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [highlightedBookingIds, setHighlightedBookingIds] = useState<Set<string>>(new Set());
  const [sidebarBooking, setSidebarBooking] = useState<BookingDetailData | null>(null);
  const [sidebarModalOpen, setSidebarModalOpen] = useState(false);

  // Max date
  const maxDate = addDays(todayStr, bookableWindowDays);

  // Check if booking is within cancellation window
  const isWithinCancellationWindow = selectedSlot
    ? new Date(selectedSlot.start_time).getTime() - Date.now() <
      cancellationWindowHours * 60 * 60 * 1000
    : false;

  // ─── Mounted guard for portal rendering ─────────────────

  useEffect(() => {
    setMounted(true);
  }, []);

  // ─── Restore pending booking after auth ─────────────────

  useEffect(() => {
    if (!mounted) return;
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
      // Reopen panel if we saved session state before auth
      if (sessionStorage.getItem("playbook-dynamic-panel-reopen")) {
        sessionStorage.removeItem("playbook-dynamic-panel-reopen");
        // Panel will open after availability loads and slot is re-selected
      }
    }
  }, [mounted, isAuthenticated, orgId, todayStr]);

  // ─── Fetch confirmed bookings for sidebar ─────────────

  const fetchBookings = useCallback(async () => {
    if (!isAuthenticated) return;
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
  }, [isAuthenticated, orgId, todayStr]);

  useEffect(() => {
    if (mounted && isAuthenticated) {
      fetchBookings();
    }
  }, [mounted, isAuthenticated, fetchBookings]);

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

  // ─── Fetch events for the selected date + facility ──────

  const fetchEvents = useCallback(async () => {
    if (!selectedDate) return;

    // Determine which bay IDs to filter by
    let bayIdsToCheck: string[] = [];
    if (selectedGroupId) {
      const group = facilityGroups.find((g) => g.id === selectedGroupId);
      if (group) bayIdsToCheck = group.bays.map((b) => b.id);
    } else if (selectedBayId) {
      bayIdsToCheck = [selectedBayId];
    } else if (!hasMultipleOptions) {
      bayIdsToCheck = bays.map((b) => b.id);
    } else {
      setDayEvents([]);
      return;
    }

    if (bayIdsToCheck.length === 0) {
      setDayEvents([]);
      return;
    }

    setLoadingEvents(true);
    const supabase = createClient();

    // Day boundaries in facility timezone
    const nextDayStr = addDays(selectedDate, 1);
    const dayStart = new Date(
      new Date(selectedDate + "T00:00:00").toLocaleString("en-US", { timeZone: timezone })
    ).toISOString();
    // Use simple date range: events starting on this date
    const { data: events } = await supabase
      .from("events")
      .select(`
        id, name, description, start_time, end_time, capacity, price_cents,
        members_only, event_bays(bay_id, bays:bay_id(name))
      `)
      .eq("org_id", orgId)
      .eq("status", "published")
      .gte("start_time", selectedDate + "T00:00:00")
      .lt("start_time", nextDayStr + "T00:00:00")
      .order("start_time");

    if (!events || events.length === 0) {
      setDayEvents([]);
      setLoadingEvents(false);
      return;
    }

    // Filter to events that involve at least one bay in the selected group/bay
    const bayIdSet = new Set(bayIdsToCheck);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filtered = events.filter((evt: any) => {
      const eventBayIds = (evt.event_bays as { bay_id: string }[])?.map((eb) => eb.bay_id) || [];
      return eventBayIds.some((id) => bayIdSet.has(id));
    });

    if (filtered.length === 0) {
      setDayEvents([]);
      setLoadingEvents(false);
      return;
    }

    // Fetch registration counts
    const countMap: Record<string, number> = {};
    await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filtered.map(async (evt: any) => {
        const { data } = await supabase.rpc("get_event_registration_count", {
          p_event_id: evt.id,
        });
        countMap[evt.id] = data ?? 0;
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: DayEvent[] = filtered.map((evt: any) => {
      const bayNames = (evt.event_bays as { bay_id: string; bays: { name: string } | { name: string }[] }[])
        ?.map((eb) => {
          if (Array.isArray(eb.bays)) return eb.bays[0]?.name;
          return eb.bays?.name;
        })
        .filter(Boolean) as string[] || [];

      return {
        id: evt.id,
        name: evt.name,
        description: evt.description,
        start_time: evt.start_time,
        end_time: evt.end_time,
        capacity: evt.capacity,
        price_cents: evt.price_cents,
        members_only: evt.members_only,
        bay_names: bayNames,
        registered_count: countMap[evt.id] || 0,
      };
    });

    setDayEvents(result);
    setLoadingEvents(false);
  }, [orgId, selectedDate, selectedGroupId, selectedBayId, facilityGroups, bays, hasMultipleOptions, timezone]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // ─── Stripe: Create checkout intent ─────────────────────

  async function createCheckoutIntent() {
    if (!selectedSlot) return;

    setCheckoutLoading(true);
    setCheckoutError("");

    try {
      const res = await fetch("/api/stripe/create-checkout-intent-dynamic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price_cents: selectedSlot.price_cents, location_id: locationId || null }),
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
    setPanelOpen(false);
    resetPaymentState();
  }

  function handleOpenPanel() {
    setBookingError("");
    setPanelOpen(true);
  }

  function handleClosePanel() {
    setPanelOpen(false);
    setBookingError("");
    setBookingNotes("");
    // Reset auth form state
    setSignInEmail("");
    setSignInPassword("");
    setSignInError("");
    setSignUpName("");
    setSignUpEmail("");
    setSignUpPassword("");
    setSignUpError("");
    setSignUpSuccess(false);
    setAuthTab("signin");
    // Reset checkout state
    resetPaymentState();
  }

  function handleCancelSelection() {
    setSelectedSlot(null);
    setPanelOpen(false);
    setBookingNotes("");
    resetPaymentState();
  }

  // Save selection to localStorage before auth reload
  function saveSelectionToStorage() {
    const data = {
      orgId,
      date: selectedDate,
      duration: selectedDuration,
      groupId: selectedGroupId,
      bayId: selectedBayId,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    sessionStorage.setItem("playbook-dynamic-panel-reopen", "true");
  }

  // Inline sign-in handler
  async function handlePanelSignIn(e: React.FormEvent) {
    e.preventDefault();
    setSignInLoading(true);
    setSignInError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: signInEmail,
      password: signInPassword,
    });

    if (error) {
      setSignInError(error.message);
      setSignInLoading(false);
      return;
    }

    // Save selection to localStorage, reload to refresh session cookies
    saveSelectionToStorage();
    window.location.reload();
  }

  // Inline sign-up handler
  async function handlePanelSignUp(e: React.FormEvent) {
    e.preventDefault();
    setSignUpLoading(true);
    setSignUpError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email: signUpEmail,
      password: signUpPassword,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { full_name: signUpName, phone: signUpPhone || undefined },
      },
    });

    if (error) {
      setSignUpError(error.message);
      setSignUpLoading(false);
      return;
    }

    setSignUpSuccess(true);
    setSignUpLoading(false);
  }

  // ─── Sidebar booking handlers ──────────────────────────

  function openSidebarBooking(booking: Booking) {
    const bayName = bays.find((b) => b.id === booking.bay_id)?.name ?? "Unknown Bay";
    setSidebarBooking({
      id: booking.id,
      date: booking.date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      total_price_cents: booking.total_price_cents,
      status: booking.status,
      confirmation_code: booking.confirmation_code,
      notes: booking.notes,
      created_at: "",
      bayName,
      canCancel: true,
      canModify: true,
    });
    setSidebarModalOpen(true);
  }

  async function handleSidebarCancel(formData: FormData) {
    const bookingId = formData.get("booking_id") as string;
    const supabase = createClient();
    const { error } = await supabase.rpc("cancel_booking", { p_booking_id: bookingId });
    if (!error) {
      setBookings((prev) => prev.filter((b) => b.id !== bookingId));
      setSidebarModalOpen(false);
      setSidebarBooking(null);
      fetchAvailability();
    }
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
      const { discountCents, label: discountLabel } = calcDiscount(selectedSlot.price_cents);

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
          location_id: locationId || undefined,
          discount_cents: discountCents || undefined,
          discount_description: discountLabel || undefined,
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

      // Desktop: show toast, refresh availability, and highlight in sidebar
      const bayInfo = result.bay_name ? ` — ${result.bay_name}` : "";
      setToast({
        message: "Booking confirmed!",
        description: `Confirmation code: ${result.confirmation_code}${bayInfo}`,
      });

      // Highlight new booking in sidebar
      if (result.booking_id) {
        setHighlightedBookingIds(new Set([result.booking_id]));
        setTimeout(() => setHighlightedBookingIds(new Set()), 8000);
      }

      fetchAvailability();
      fetchBookings();
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


  // ─── Chat booking action handler ─────────────────────

  const handleBookingAction = useCallback(
    (action: BookingAction) => {
      // If date differs, change date and store the action to process after availability loads
      if (action.date !== selectedDate) {
        pendingBookingAction.current = action;
        setSelectedDate(action.date);
        if (action.duration) setSelectedDuration(action.duration);
        return;
      }

      // Same date — try to find matching slot immediately
      processChatBookingAction(action);
    },
    [selectedDate, availableSlots, timezone]
  );

  function processChatBookingAction(action: BookingAction) {
    // Update duration if provided
    if (action.duration && action.duration !== selectedDuration) {
      pendingBookingAction.current = action;
      setSelectedDuration(action.duration);
      return;
    }

    // Find matching slot by start_time (formatted time comparison)
    const normalizeTime = (t: string) =>
      t.toLowerCase().replace(/\s+/g, " ").trim();
    const requestedTime = normalizeTime(action.start_time);

    const matchedSlot = availableSlots.find((s) => {
      // Try formatted time match
      const formatted = normalizeTime(formatTime(s.start_time, timezone));
      if (formatted === requestedTime) return true;
      // Try ISO timestamp match
      if (s.start_time === action.start_time) return true;
      return false;
    });

    if (matchedSlot) {
      handleSelectSlot(matchedSlot);
    }
    pendingBookingAction.current = null;
  }

  // Process pending booking action after availability loads
  useEffect(() => {
    if (!pendingBookingAction.current || loadingSlots || availableSlots.length === 0) return;
    processChatBookingAction(pendingBookingAction.current);
  }, [loadingSlots, availableSlots]);

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

  const stepLabels = requiresPayment
    ? ["Booking Details", "Payment Method", "Confirm Booking"]
    : ["Booking Details", "Confirm Booking"];

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
                <h3 className="flex-1 text-sm font-semibold">Confirmed Bookings</h3>
                <a
                  href="/my-bookings"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="View all bookings"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
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
                    const bayName =
                      bays.find((b) => b.id === booking.bay_id)?.name ??
                      "Unknown Bay";
                    const price = `$${(booking.total_price_cents / 100).toFixed(2)}`;
                    const isHighlighted = highlightedBookingIds.has(booking.id);

                    return (
                      <button
                        type="button"
                        key={booking.id}
                        onClick={() => openSidebarBooking(booking)}
                        className={`block w-full rounded-lg border bg-background p-3 text-left transition-all duration-700 hover:bg-muted/50 ${
                          isHighlighted
                            ? "border-green-400 shadow-[0_0_8px_rgba(74,222,128,0.3)]"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {booking.confirmation_code}
                          </span>
                          <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
                        </div>
                        <p className="mt-1 text-sm font-medium">{bayName}</p>
                        <div className="mt-1 flex items-center justify-between">
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
              <Sparkles className="h-3.5 w-3.5" />
              <span className="flex-1">Booking Assistant</span>
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
                  onBookingAction={handleBookingAction}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ Main Content ═══ */}
      <div className="min-w-0 flex-1 space-y-4">
      {/* Location Switcher (multi-location orgs only) */}
      {locationsEnabled && locations.length > 1 && locationId && (
        <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5">
          <LocationSwitcher
            locations={locations}
            activeLocationId={locationId}
          />
        </div>
      )}
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

      {/* Step 4: Events on this date for the selected facility */}
      {(dayEvents.length > 0 || loadingEvents) && (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-green-600 dark:text-green-400" />
            <h3 className="text-sm font-medium text-muted-foreground">
              Events
              {selectedOption && (
                <span className="ml-1.5">
                  &middot; {selectedOption}
                </span>
              )}
            </h3>
          </div>

          {loadingEvents ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2">
              {dayEvents.map((evt) => {
                const spotsLeft = evt.capacity - evt.registered_count;
                const priceLabel = evt.price_cents === 0
                  ? "Free"
                  : `$${(evt.price_cents / 100).toFixed(2)}`;

                return (
                  <button
                    key={evt.id}
                    type="button"
                    onClick={() => {
                      setSelectedEventForPanel({
                        id: evt.id,
                        name: evt.name,
                        description: evt.description,
                        startTime: evt.start_time,
                        endTime: evt.end_time,
                        capacity: evt.capacity,
                        registeredCount: evt.registered_count,
                        priceCents: evt.price_cents,
                        membersOnly: evt.members_only,
                        bayNames: evt.bay_names.join(", "),
                      });
                    }}
                    className="flex w-full items-center justify-between rounded-lg border border-green-200 bg-green-50/50 px-4 py-3 text-left transition-colors hover:bg-green-100/70 dark:border-green-900/30 dark:bg-green-950/20 dark:hover:bg-green-950/40"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
                        <CalendarDays className="h-4 w-4 text-green-700 dark:text-green-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{evt.name}</p>
                          {evt.members_only && (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              Members Only
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatTime(evt.start_time, timezone)} &ndash; {formatTime(evt.end_time, timezone)}
                        </p>
                        {evt.bay_names.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-1.5">
                            {evt.bay_names.map((name) => (
                              <span
                                key={name}
                                className="inline-block rounded-full bg-green-100/80 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/20 dark:text-green-400"
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-sm font-semibold">{priceLabel}</span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        {spotsLeft > 0 ? `${spotsLeft} spot${spotsLeft !== 1 ? "s" : ""} left` : "Full"}
                      </span>
                    </div>
                  </button>
                );
              })}
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
      {selectedSlot && <div className="h-20" />}
      </div>{/* end Main Content */}

      {/* ===== Booking bar / slide-up panel — portalled to body ===== */}
      {selectedSlot &&
        mounted &&
        createPortal(
          <>
            {/* Backdrop overlay when panel is open */}
            {panelOpen && (
              <div
                className="fixed inset-0 z-50 bg-black/40 transition-opacity"
                onClick={handleClosePanel}
              />
            )}

            {/* The bar / panel */}
            <div
              className={`fixed inset-x-0 bottom-0 z-50 bg-background transition-all duration-300 ease-in-out ${
                panelOpen
                  ? "max-h-[85vh] overflow-y-auto rounded-t-2xl shadow-2xl"
                  : "border-t shadow-[0_-4px_12px_rgba(0,0,0,0.1)]"
              }`}
            >
              {!panelOpen ? (
                /* ---- Collapsed CTA bar ---- */
                <div className="mx-auto flex max-w-6xl items-center justify-between p-4 px-6">
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
                    <Button onClick={handleOpenPanel} className="gap-2">
                      Continue to Book
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                /* ---- Expanded booking panel ---- */
                <div className="mx-auto max-w-lg px-6 py-6">
                  {/* Panel header */}
                  <div className={isAuthenticated ? "sticky top-0 z-10 -mx-6 bg-background px-6 pb-4 pt-0" : "mb-6"}>
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-bold">Confirm Booking</h2>
                        <p className="text-sm text-muted-foreground">
                          {formatShortDate(selectedDate)} &middot;{" "}
                          {formatTime(selectedSlot.start_time, timezone)} &ndash;{" "}
                          {formatTime(selectedSlot.end_time, timezone)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleClosePanel}
                        className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>

                    {/* Step indicator — only for authenticated users */}
                    {isAuthenticated && (
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
                    )}
                  </div>

                  {!isAuthenticated ? (
                    /* ---- Auth form for unauthenticated users ---- */
                    <div>
                      {/* Booking summary preview above auth */}
                      <div className="mb-6 rounded-lg border bg-muted/50 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{selectedSlot.bay_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDurationLong(selectedDuration)}
                            </p>
                          </div>
                          <span className="text-sm font-bold">
                            ${(selectedSlot.price_cents / 100).toFixed(2)}
                          </span>
                        </div>
                      </div>

                      <p className="mb-4 text-sm text-muted-foreground">
                        Sign in or create an account to complete your booking.
                      </p>

                      <Tabs value={authTab} onValueChange={setAuthTab} className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                          <TabsTrigger value="signin">Sign In</TabsTrigger>
                          <TabsTrigger value="signup">Sign Up</TabsTrigger>
                        </TabsList>

                        <TabsContent value="signin">
                          <form onSubmit={handlePanelSignIn} className="space-y-4 pt-2">
                            {signInError && (
                              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                                {signInError}
                              </div>
                            )}
                            <div className="space-y-2">
                              <Label htmlFor="dynamic-panel-signin-email">Email</Label>
                              <Input
                                id="dynamic-panel-signin-email"
                                type="email"
                                placeholder="you@example.com"
                                value={signInEmail}
                                onChange={(e) => setSignInEmail(e.target.value)}
                                required
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="dynamic-panel-signin-password">Password</Label>
                              <Input
                                id="dynamic-panel-signin-password"
                                type="password"
                                value={signInPassword}
                                onChange={(e) => setSignInPassword(e.target.value)}
                                required
                              />
                            </div>
                            <Button type="submit" className="w-full" disabled={signInLoading}>
                              {signInLoading ? "Signing in..." : "Sign In & Book"}
                            </Button>
                          </form>
                        </TabsContent>

                        <TabsContent value="signup">
                          {signUpSuccess ? (
                            <div className="space-y-3 pt-2">
                              <div className="rounded-md bg-muted p-4 text-center">
                                <p className="font-medium">Check your email</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  We sent a confirmation link to{" "}
                                  <span className="font-medium">{signUpEmail}</span>. Click
                                  the link to activate your account, then sign in.
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                className="w-full"
                                onClick={() => {
                                  setSignUpSuccess(false);
                                  setAuthTab("signin");
                                  setSignInEmail(signUpEmail);
                                }}
                              >
                                Go to Sign In
                              </Button>
                            </div>
                          ) : (
                            <form onSubmit={handlePanelSignUp} className="space-y-4 pt-2">
                              {signUpError && (
                                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                                  {signUpError}
                                </div>
                              )}
                              <div className="space-y-2">
                                <Label htmlFor="dynamic-panel-signup-name">Full Name</Label>
                                <Input
                                  id="dynamic-panel-signup-name"
                                  type="text"
                                  placeholder="John Doe"
                                  value={signUpName}
                                  onChange={(e) => setSignUpName(e.target.value)}
                                  required
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="dynamic-panel-signup-phone">
                                  Phone Number{" "}
                                  <span className="text-muted-foreground font-normal">(optional)</span>
                                </Label>
                                <Input
                                  id="dynamic-panel-signup-phone"
                                  type="tel"
                                  placeholder="(555) 123-4567"
                                  value={signUpPhone}
                                  onChange={(e) => setSignUpPhone(e.target.value)}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="dynamic-panel-signup-email">Email</Label>
                                <Input
                                  id="dynamic-panel-signup-email"
                                  type="email"
                                  placeholder="you@example.com"
                                  value={signUpEmail}
                                  onChange={(e) => setSignUpEmail(e.target.value)}
                                  required
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="dynamic-panel-signup-password">Password</Label>
                                <Input
                                  id="dynamic-panel-signup-password"
                                  type="password"
                                  placeholder="At least 6 characters"
                                  value={signUpPassword}
                                  onChange={(e) => setSignUpPassword(e.target.value)}
                                  minLength={6}
                                  required
                                />
                              </div>
                              <Button type="submit" className="w-full" disabled={signUpLoading}>
                                {signUpLoading ? "Creating account..." : "Create Account"}
                              </Button>
                            </form>
                          )}
                        </TabsContent>
                      </Tabs>
                    </div>
                  ) : (
                    /* ---- Authenticated: Multi-step booking wizard ---- */
                    <div className="space-y-4">
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
                            {(() => {
                              const disc = calcDiscount(selectedSlot.price_cents);
                              return (
                                <>
                                  {disc.discountCents > 0 && (
                                    <>
                                      <div className="flex justify-between border-t pt-2 text-sm text-muted-foreground">
                                        <span>Subtotal</span>
                                        <span>${(selectedSlot.price_cents / 100).toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between text-sm text-teal-600 dark:text-teal-400">
                                        <span className="flex items-center gap-1">
                                          <Crown className="h-3.5 w-3.5" />
                                          {disc.label}
                                        </span>
                                        <span>-${(disc.discountCents / 100).toFixed(2)}</span>
                                      </div>
                                    </>
                                  )}
                                  <div className={`flex justify-between text-sm ${disc.discountCents > 0 ? "" : "border-t pt-2"}`}>
                                    <span className="font-medium">Total</span>
                                    <span className="text-lg font-bold">
                                      ${(disc.finalCents / 100).toFixed(2)}
                                    </span>
                                  </div>
                                </>
                              );
                            })()}
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

                          {/* Guest upsell nudge */}
                          {membership?.membershipEnabled && !membership.isMember && isAuthenticated && (
                            <a
                              href="/membership"
                              className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
                            >
                              <Crown className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                              <span className="text-amber-800 dark:text-amber-200">
                                <span className="font-medium">Join {membership.tierName || "Membership"}</span>
                                {" — "}
                                {membership.discountType === "percent"
                                  ? `Save ${membership.discountValue}% on every booking`
                                  : membership.discountValue > 0
                                    ? `Save $${membership.discountValue.toFixed(2)} on every booking`
                                    : `Book up to ${membership.memberWindowDays} days ahead`}
                              </span>
                              <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                            </a>
                          )}

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

                            {(() => {
                              const disc = calcDiscount(selectedSlot.price_cents);
                              return (
                                <>
                                  {disc.discountCents > 0 && (
                                    <div className="flex items-center justify-between border-t pt-3 text-sm text-teal-600 dark:text-teal-400">
                                      <span className="flex items-center gap-1">
                                        <Crown className="h-3.5 w-3.5" />
                                        {disc.label}
                                      </span>
                                      <span>-${(disc.discountCents / 100).toFixed(2)}</span>
                                    </div>
                                  )}
                                  <div className={`flex items-center justify-between text-sm font-bold ${disc.discountCents > 0 ? "" : "border-t pt-3"}`}>
                                    <span>Total</span>
                                    <span>
                                      ${(disc.finalCents / 100).toFixed(2)}
                                    </span>
                                  </div>
                                </>
                              );
                            })()}
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
                                `Confirm & Pay $${(calcDiscount(selectedSlot.price_cents).finalCents / 100).toFixed(2)}`
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
                </div>
              )}
            </div>
          </>,
          document.body
        )}

      {/* Sidebar booking detail modal */}
      <BookingDetailsModal
        booking={sidebarBooking}
        variant="customer"
        timezone={timezone}
        open={sidebarModalOpen}
        onOpenChange={(open) => {
          setSidebarModalOpen(open);
          if (!open) setSidebarBooking(null);
        }}
        cancelAction={handleSidebarCancel}
        cancellationWindowHours={cancellationWindowHours}
        paymentMode={paymentMode}
      />

      {/* Event registration panel */}
      {selectedEventForPanel && (
        <EventRegistrationPanel
          event={selectedEventForPanel}
          timezone={timezone}
          isAuthenticated={isAuthenticated}
          isMember={membership?.isMember ?? false}
          paymentMode={paymentMode}
          onClose={() => setSelectedEventForPanel(null)}
          onRegistered={() => {
            setSelectedEventForPanel(null);
            fetchEvents();
            setToast({ message: "Registration successful!" });
          }}
        />
      )}
    </div>
  );
}
