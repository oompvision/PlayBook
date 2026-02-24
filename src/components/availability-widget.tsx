"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toast } from "@/components/ui/toast";
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
  X,
  ExternalLink,
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
  userEmail?: string;
  userFullName?: string | null;
  userProfileId?: string;
  /** "customer" (default) = normal booking flow; "admin-guest" = admin books for a guest */
  mode?: "customer" | "admin-guest";
};

type ToastData = {
  message: string;
  description?: string;
};

// localStorage key for persisting selection across auth reload
const STORAGE_KEY = "playbook-pending-booking";

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

/** Group consecutive slots into combined time ranges for display. */
function groupConsecutiveSlots(
  slotIds: string[],
  slotMap: Map<string, Slot>,
  timezone: string
): Array<{ start_time: string; end_time: string; price_cents: number; slot_count: number }> {
  const sorted = slotIds
    .map((id) => slotMap.get(id))
    .filter(Boolean)
    .sort((a, b) => new Date(a!.start_time).getTime() - new Date(b!.start_time).getTime()) as Slot[];

  const groups: Array<{ start_time: string; end_time: string; price_cents: number; slot_count: number }> = [];
  for (const slot of sorted) {
    const last = groups[groups.length - 1];
    if (last && new Date(slot.start_time).getTime() === new Date(last.end_time).getTime()) {
      last.end_time = slot.end_time;
      last.price_cents += slot.price_cents;
      last.slot_count += 1;
    } else {
      groups.push({
        start_time: slot.start_time,
        end_time: slot.end_time,
        price_cents: slot.price_cents,
        slot_count: 1,
      });
    }
  }
  return groups;
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
  userEmail,
  userFullName,
  userProfileId,
  mode = "customer",
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
  const [chatExpanded, setChatExpanded] = useState(false);

  // Booking panel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [bookingInProgress, setBookingInProgress] = useState(false);
  const [bookingError, setBookingError] = useState("");

  // Inline auth state (for unauthenticated users in the panel)
  const [authTab, setAuthTab] = useState<string>("signin");
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState("");
  const [signInLoading, setSignInLoading] = useState(false);
  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpError, setSignUpError] = useState("");
  const [signUpLoading, setSignUpLoading] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);

  // Guest booking state (admin-guest mode)
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");

  // Toast state
  const [toastData, setToastData] = useState<ToastData | null>(null);

  // Bookings state
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [highlightedBookingIds, setHighlightedBookingIds] = useState<Set<string>>(new Set());

  // Track whether we restored from localStorage (to auto-open panel)
  const restoredFromStorage = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Restore slot selection from localStorage after auth reload
  useEffect(() => {
    if (!mounted) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      localStorage.removeItem(STORAGE_KEY);

      if (parsed.orgId !== orgId) return; // Different facility, ignore

      // Restore state
      if (parsed.date) setSelectedDate(parsed.date);
      if (parsed.bayId) setSelectedBayId(parsed.bayId);
      if (parsed.slotIds?.length) {
        setSelectedSlotIds(new Set(parsed.slotIds));
        restoredFromStorage.current = true;
      }
      if (parsed.notes) setNotes(parsed.notes);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [mounted, orgId]);

  // Fetch upcoming confirmed bookings for the current user (skip in admin-guest mode)
  const fetchBookings = useCallback(async () => {
    if (!isAuthenticated || mode === "admin-guest") return;
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
  }, [isAuthenticated, orgId, todayStr, mode]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

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
      // Only clear selection if we're NOT restoring from localStorage
      if (!restoredFromStorage.current) {
        setSelectedSlotIds(new Set());
      }
      restoredFromStorage.current = false;

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

  // Auto-open panel after restoring from localStorage (post-auth reload)
  useEffect(() => {
    if (mounted && selectedSlotIds.size > 0 && isAuthenticated) {
      // Check if we just restored — the panel should open
      const stored = sessionStorage.getItem("playbook-panel-reopen");
      if (stored) {
        sessionStorage.removeItem("playbook-panel-reopen");
        setPanelOpen(true);
      }
    }
  }, [mounted, selectedSlotIds.size, isAuthenticated]);

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

  function handleOpenPanel() {
    setBookingError("");
    setPanelOpen(true);
  }

  function handleClosePanel() {
    setPanelOpen(false);
    setBookingError("");
    setNotes("");
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
    // Reset guest fields
    setGuestName("");
    setGuestEmail("");
    setGuestPhone("");
  }

  // Save selection to localStorage before auth reload
  function saveSelectionToStorage() {
    const data = {
      orgId,
      date: selectedDate,
      bayId: selectedBayId,
      slotIds: Array.from(selectedSlotIds),
      notes,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    sessionStorage.setItem("playbook-panel-reopen", "true");
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
        data: { full_name: signUpName },
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

  // Confirm booking — client-side via Supabase RPC
  async function handleConfirmBooking() {
    if (!userProfileId) return;

    setBookingInProgress(true);
    setBookingError("");

    const supabase = createClient();
    const slotIdsArray = Array.from(selectedSlotIds);

    // Re-validate slot availability
    const { data: freshSlots } = await supabase
      .from("bay_schedule_slots")
      .select("id, status")
      .in("id", slotIdsArray);

    const unavailable = freshSlots?.filter((s) => s.status !== "available") || [];
    if (unavailable.length > 0) {
      setBookingError("One or more selected slots are no longer available. Please close and select different time slots.");
      setBookingInProgress(false);
      return;
    }

    // Create the booking via RPC
    const { data, error } = await supabase.rpc("create_booking", {
      p_org_id: orgId,
      p_customer_id: userProfileId,
      p_bay_id: selectedBayId,
      p_date: selectedDate,
      p_slot_ids: slotIdsArray,
      p_notes: notes || null,
    });

    if (error) {
      setBookingError(error.message);
      setBookingInProgress(false);
      return;
    }

    // Extract confirmation codes from the RPC result
    const bookingResults = Array.isArray(data) ? data : [data];
    const codes = bookingResults.map(
      (r: { confirmation_code: string }) => r.confirmation_code
    );
    const newBookingIds = bookingResults.map(
      (r: { booking_id: string }) => r.booking_id
    );

    // Detect if mobile (matches the lg: breakpoint used in layout)
    const isMobile = window.innerWidth < 1024;

    if (isMobile) {
      // On mobile, redirect to /my-bookings with success toast via URL params
      const codesStr = codes.join(",");
      router.push(`/my-bookings?success=true&codes=${codesStr}`);
      return;
    }

    // Desktop: close panel, clear selection, show toast, refresh data
    setPanelOpen(false);
    setSelectedSlotIds(new Set());
    setNotes("");
    setBookingInProgress(false);

    // Show toast
    setToastData({
      message: "Booking Confirmed!",
      description: `Confirmation ${codes.length > 1 ? "codes" : "code"}: ${codes.join(", ")}`,
    });

    // Highlight new bookings in sidebar
    setHighlightedBookingIds(new Set(newBookingIds));
    setTimeout(() => setHighlightedBookingIds(new Set()), 8000);

    // Refresh slots (booked slots should disappear) and bookings list
    fetchSlots(selectedDate, selectedBayId);
    fetchBookings();
  }

  // Confirm guest booking — admin creates on behalf of a guest
  async function handleConfirmGuestBooking() {
    if (!guestName.trim()) return;

    setBookingInProgress(true);
    setBookingError("");

    const supabase = createClient();
    const slotIdsArray = Array.from(selectedSlotIds);

    // Re-validate slot availability
    const { data: freshSlots } = await supabase
      .from("bay_schedule_slots")
      .select("id, status")
      .in("id", slotIdsArray);

    const unavailable = freshSlots?.filter((s) => s.status !== "available") || [];
    if (unavailable.length > 0) {
      setBookingError("One or more selected slots are no longer available. Please close and select different time slots.");
      setBookingInProgress(false);
      return;
    }

    const { data, error } = await supabase.rpc("create_guest_booking", {
      p_org_id: orgId,
      p_bay_id: selectedBayId,
      p_date: selectedDate,
      p_slot_ids: slotIdsArray,
      p_guest_name: guestName.trim(),
      p_guest_email: guestEmail.trim() || null,
      p_guest_phone: guestPhone.trim() || null,
      p_notes: notes || null,
    });

    if (error) {
      setBookingError(error.message);
      setBookingInProgress(false);
      return;
    }

    const bookingResults = Array.isArray(data) ? data : [data];
    const codes = bookingResults.map(
      (r: { confirmation_code: string }) => r.confirmation_code
    );

    // Redirect back to admin bookings with success message
    router.push(`/admin/bookings?guest_booked=true&codes=${codes.join(",")}`);
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

  // Build slot map for grouping
  const slotMap = new Map(slots.map((s) => [s.id, s]));
  const selectedGroups = selectedSlotIds.size > 0
    ? groupConsecutiveSlots(Array.from(selectedSlotIds), slotMap, timezone)
    : [];

  const isAdminGuest = mode === "admin-guest";

  return (
    <div className={isAdminGuest ? "" : "flex items-start gap-6"}>
      {/* ===== Sidebar — Confirmed Bookings + Chat Assistant (desktop only, hidden in admin-guest mode) ===== */}
      {!isAdminGuest && (
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
                    const isExpanded = expandedBookingId === booking.id;
                    const bayName =
                      bays.find((b) => b.id === booking.bay_id)?.name ??
                      "Unknown Bay";
                    const price = `$${(booking.total_price_cents / 100).toFixed(2)}`;
                    const isCancelling = cancellingId === booking.id;
                    const isHighlighted = highlightedBookingIds.has(booking.id);

                    return (
                      <div
                        key={booking.id}
                        className={`rounded-lg border bg-background transition-all duration-700 ${
                          isHighlighted
                            ? "border-green-400 shadow-[0_0_8px_rgba(74,222,128,0.3)]"
                            : ""
                        }`}
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
                              variant="outline"
                              size="sm"
                              className="h-7 w-full text-xs text-destructive hover:bg-destructive/10"
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
      )}

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

      {/* ===== Booking bar / slide-up panel — portalled to body ===== */}
      {selectedSlotIds.size > 0 &&
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
                  <div>
                    <p className="text-sm font-medium">
                      {selectedSlotIds.size} slot
                      {selectedSlotIds.size !== 1 ? "s" : ""} selected
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Total: ${(totalCents / 100).toFixed(2)}
                    </p>
                  </div>
                  <Button onClick={handleOpenPanel} className="gap-2">
                    Continue to Book
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                /* ---- Expanded booking panel ---- */
                <div className="mx-auto max-w-lg px-6 py-6">
                  {/* Panel header */}
                  <div className="mb-6 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold">Confirm Booking</h2>
                      <p className="text-sm text-muted-foreground">
                        {formatDateLabel(selectedDate)}
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

                  {isAdminGuest ? (
                    /* ---- Admin guest booking: guest info form + confirm ---- */
                    <div>
                      {/* Error banner */}
                      {bookingError && (
                        <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                          {bookingError}
                        </div>
                      )}

                      {/* Booking summary */}
                      <div className="mb-4 rounded-lg border p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div>
                            <p className="font-medium">{selectedBay?.name}</p>
                            {selectedBay?.resource_type && (
                              <Badge variant="outline" className="mt-1">
                                {selectedBay.resource_type}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          {selectedGroups.map((group) => (
                            <div
                              key={group.start_time}
                              className="flex items-center justify-between text-sm"
                            >
                              <span>
                                {formatTime(group.start_time, timezone)} &ndash;{" "}
                                {formatTime(group.end_time, timezone)}
                                {group.slot_count > 1 && (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    ({group.slot_count} slots)
                                  </span>
                                )}
                              </span>
                              <span className="text-muted-foreground">
                                ${(group.price_cents / 100).toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 border-t pt-3">
                          <div className="flex items-center justify-between font-bold">
                            <span>Total</span>
                            <span>${(totalCents / 100).toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Guest info form */}
                      <div className="mb-4 space-y-3">
                        <p className="text-sm font-medium">Guest Information</p>
                        <div className="space-y-2">
                          <Label htmlFor="guest-name">Name *</Label>
                          <Input
                            id="guest-name"
                            type="text"
                            placeholder="Guest name"
                            value={guestName}
                            onChange={(e) => setGuestName(e.target.value)}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="guest-email">Email (optional)</Label>
                          <Input
                            id="guest-email"
                            type="email"
                            placeholder="guest@example.com"
                            value={guestEmail}
                            onChange={(e) => setGuestEmail(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="guest-phone">Phone (optional)</Label>
                          <Input
                            id="guest-phone"
                            type="tel"
                            placeholder="(555) 123-4567"
                            value={guestPhone}
                            onChange={(e) => setGuestPhone(e.target.value)}
                          />
                        </div>
                      </div>

                      {/* Notes */}
                      <div className="mb-4 space-y-2">
                        <Label htmlFor="guest-booking-notes">Notes (optional)</Label>
                        <Input
                          id="guest-booking-notes"
                          placeholder="Any special requests..."
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                        />
                      </div>

                      {/* Confirm button */}
                      <Button
                        className="w-full"
                        size="lg"
                        disabled={bookingInProgress || !guestName.trim()}
                        onClick={handleConfirmGuestBooking}
                      >
                        {bookingInProgress ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Booking...
                          </>
                        ) : (
                          "Confirm Guest Booking"
                        )}
                      </Button>
                    </div>
                  ) : !isAuthenticated ? (
                    /* ---- Auth form for unauthenticated users ---- */
                    <div>
                      {/* Show booking summary preview above auth */}
                      <div className="mb-6 rounded-lg border bg-muted/50 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{selectedBay?.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {selectedSlotIds.size} slot{selectedSlotIds.size !== 1 ? "s" : ""}
                            </p>
                          </div>
                          <span className="text-sm font-bold">
                            ${(totalCents / 100).toFixed(2)}
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
                              <Label htmlFor="panel-signin-email">Email</Label>
                              <Input
                                id="panel-signin-email"
                                type="email"
                                placeholder="you@example.com"
                                value={signInEmail}
                                onChange={(e) => setSignInEmail(e.target.value)}
                                required
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="panel-signin-password">Password</Label>
                              <Input
                                id="panel-signin-password"
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
                                <Label htmlFor="panel-signup-name">Full Name</Label>
                                <Input
                                  id="panel-signup-name"
                                  type="text"
                                  placeholder="John Doe"
                                  value={signUpName}
                                  onChange={(e) => setSignUpName(e.target.value)}
                                  required
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="panel-signup-email">Email</Label>
                                <Input
                                  id="panel-signup-email"
                                  type="email"
                                  placeholder="you@example.com"
                                  value={signUpEmail}
                                  onChange={(e) => setSignUpEmail(e.target.value)}
                                  required
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="panel-signup-password">Password</Label>
                                <Input
                                  id="panel-signup-password"
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
                    /* ---- Authenticated: Booking summary + confirm ---- */
                    <div>
                      {/* Error banner */}
                      {bookingError && (
                        <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                          {bookingError}
                        </div>
                      )}

                      {/* Booking summary */}
                      <div className="mb-4 rounded-lg border p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div>
                            <p className="font-medium">{selectedBay?.name}</p>
                            {selectedBay?.resource_type && (
                              <Badge variant="outline" className="mt-1">
                                {selectedBay.resource_type}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          {selectedGroups.map((group) => (
                            <div
                              key={group.start_time}
                              className="flex items-center justify-between text-sm"
                            >
                              <span>
                                {formatTime(group.start_time, timezone)} &ndash;{" "}
                                {formatTime(group.end_time, timezone)}
                                {group.slot_count > 1 && (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    ({group.slot_count} slots)
                                  </span>
                                )}
                              </span>
                              <span className="text-muted-foreground">
                                ${(group.price_cents / 100).toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 border-t pt-3">
                          <div className="flex items-center justify-between font-bold">
                            <span>Total</span>
                            <span>${(totalCents / 100).toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Notes */}
                      <div className="mb-4 space-y-2">
                        <Label htmlFor="booking-notes">Notes (optional)</Label>
                        <Input
                          id="booking-notes"
                          placeholder="Any special requests..."
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                        />
                      </div>

                      {/* User info */}
                      <p className="mb-4 text-sm text-muted-foreground">
                        Booking as {userFullName || userEmail}
                      </p>

                      {/* Confirm button */}
                      <Button
                        className="w-full"
                        size="lg"
                        disabled={bookingInProgress}
                        onClick={handleConfirmBooking}
                      >
                        {bookingInProgress ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Booking...
                          </>
                        ) : (
                          "Confirm Booking"
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>,
          document.body
        )}

      {/* Toast notification */}
      {toastData && (
        <Toast
          message={toastData.message}
          description={toastData.description}
          duration={10000}
          onClose={() => setToastData(null)}
        />
      )}
    </div>
  );
}
