"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  StripeCheckoutWrapper,
  CheckoutForm,
  type CheckoutFormHandle,
} from "@/components/checkout-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  ArrowLeft,
  ArrowUpRight,
  MessageSquare,
  LogIn,
  X,
  ExternalLink,
  Check,
  CreditCard,
  AlertTriangle,
  MapPin,
  ShieldCheck,
  Crown,
} from "lucide-react";
import { ChatWidget, type BookingAction } from "@/components/chat/chat-widget";
import { AuthModal } from "@/components/auth-modal";
import {
  BookingDetailsModal,
  type BookingDetailData,
} from "@/components/booking-details-modal";
import { LocationSwitcher } from "@/components/location-switcher";

type Bay = {
  id: string;
  name: string;
  resource_type: string | null;
};

type TimeGroup = {
  key: string;
  start_time: string;
  end_time: string;
  min_price_cents: number;
  all_same_price: boolean;
  available_bays: Array<{
    bay_id: string;
    bay_name: string;
    slot_id: string;
    price_cents: number;
  }>;
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

export type OriginalBookingInfo = {
  id: string;
  confirmationCode: string;
  bayId: string;
  bayName: string;
  date: string;
  startTime: string;
  endTime: string;
  totalPriceCents: number;
  notes: string | null;
  isGuest: boolean;
  slotIds: string[];
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
  /** "customer" (default) = normal booking flow; "admin-guest" = admin books for a guest; "modify" = modify existing booking */
  mode?: "customer" | "admin-guest" | "modify";
  /** Original booking info when mode is "modify" */
  originalBooking?: OriginalBookingInfo;
  /** Where to redirect after modification — e.g. "/my-bookings" or "/admin/bookings" */
  modifyRedirectBase?: string;
  /** Org's payment mode — "none" | "charge_upfront" | "hold" | "hold_charge_manual" */
  paymentMode?: string;
  /** Cancellation window in hours (default 24) */
  cancellationWindowHours?: number;
  /** Active location ID for multi-location orgs */
  locationId?: string | null;
  /** Available locations for the location switcher */
  locations?: Array<{ id: string; name: string; is_default: boolean; address: string | null }>;
  /** Whether multi-location is enabled for this org */
  locationsEnabled?: boolean;
  /** How many days into the future customers can book (default 30) */
  bookableWindowDays?: number;
  /** Membership context for discount + upsell */
  membership?: {
    isMember: boolean;
    effectiveWindowDays: number;
    guestWindowDays: number;
    memberWindowDays: number;
    discountType: "flat" | "percent" | null;
    discountValue: number;
    tierName: string | null;
    membershipEnabled: boolean;
  };
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
  originalBooking,
  modifyRedirectBase,
  paymentMode = "none",
  cancellationWindowHours = 24,
  locationId,
  locations = [],
  locationsEnabled = false,
  bookableWindowDays = 30,
  membership,
}: AvailabilityWidgetProps) {
  const router = useRouter();
  const isModify = mode === "modify";

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

  // Compute the max bookable date from today + bookable window
  const maxBookableDateStr = addDays(todayStr, bookableWindowDays);

  // Fire-and-forget notification to server (non-blocking)
  function fireNotification(
    action: "confirmed" | "canceled" | "modified",
    opts: { bookingId?: string; confirmationCode?: string; oldConfirmationCode?: string }
  ) {
    fetch("/api/notifications/booking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, orgId, ...opts }),
    }).catch(() => {});
  }
  const [selectedDate, setSelectedDate] = useState(
    isModify && originalBooking ? originalBooking.date : todayStr
  );
  const [timeGroups, setTimeGroups] = useState<TimeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTimeKeys, setSelectedTimeKeys] = useState<Set<string>>(new Set());
  const [selectedBayIdForBooking, setSelectedBayIdForBooking] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [autoAdvancedFrom, setAutoAdvancedFrom] = useState<string | null>(null);
  const [chatExpanded, setChatExpanded] = useState(false);

  // Booking panel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [notes, setNotes] = useState(
    isModify && originalBooking?.notes ? originalBooking.notes : ""
  );
  const [bookingInProgress, setBookingInProgress] = useState(false);
  const [bookingError, setBookingError] = useState("");

  // Inline auth state (for unauthenticated users in the panel)
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

  // Checkout / payment state
  const requiresPayment = paymentMode !== "none" && mode === "customer";
  const checkoutFormRef = useRef<CheckoutFormHandle | null>(null);
  const [checkoutIntent, setCheckoutIntent] = useState<{
    client_secret: string;
    intent_type: "payment" | "setup";
    intent_id: string;
    stripe_customer_id: string;
    stripe_account_id: string;
    amount_cents: number;
    cancellation_policy_text: string;
  } | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [policyAgreed, setPolicyAgreed] = useState(false);
  const [policyAgreedAt, setPolicyAgreedAt] = useState<string | null>(null);

  // Multi-step wizard state (authenticated booking flow)
  const [bookingStep, setBookingStep] = useState<1 | 2 | 3>(1);
  const [paymentValidated, setPaymentValidated] = useState(false);
  const [paymentValidationError, setPaymentValidationError] = useState("");
  const [confirmPolicyModalOpen, setConfirmPolicyModalOpen] = useState(false);
  const [cardBrand, setCardBrand] = useState<string | null>(null);
  const [cardLast4, setCardLast4] = useState<string | null>(null);
  const [confirmedPaymentMethodId, setConfirmedPaymentMethodId] = useState<string | null>(null);

  // Guest booking state (admin-guest mode)
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");

  // Toast state
  const [toastData, setToastData] = useState<ToastData | null>(null);

  // Bookings state
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [highlightedBookingIds, setHighlightedBookingIds] = useState<Set<string>>(new Set());
  const [sidebarBooking, setSidebarBooking] = useState<BookingDetailData | null>(null);
  const [sidebarModalOpen, setSidebarModalOpen] = useState(false);

  // Track whether we restored from localStorage (to auto-open panel)
  const restoredFromStorage = useRef(false);
  // Pending booking action from chat (needs to wait for timeGroups to load after date change)
  const pendingBookingAction = useRef<BookingAction | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Restore slot selection from localStorage after auth reload (skip in modify mode)
  useEffect(() => {
    if (!mounted || isModify) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      localStorage.removeItem(STORAGE_KEY);

      if (parsed.orgId !== orgId) return; // Different facility, ignore

      // Restore state
      if (parsed.date) setSelectedDate(parsed.date);
      if (parsed.bayIdForBooking) setSelectedBayIdForBooking(parsed.bayIdForBooking);
      if (parsed.timeKeys?.length) {
        setSelectedTimeKeys(new Set(parsed.timeKeys));
        restoredFromStorage.current = true;
      }
      if (parsed.notes) setNotes(parsed.notes);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [mounted, orgId]);

  // Fetch upcoming confirmed bookings for the current user (skip in admin-guest/modify mode)
  const fetchBookings = useCallback(async () => {
    if (!isAuthenticated || mode === "admin-guest" || isModify) return;
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
  // Skip in modify mode (date is pre-set from original booking).
  useEffect(() => {
    if (isModify) return;
    async function checkAndAutoAdvance() {
      const supabase = createClient();

      // Compute effective start for today (now + lead time, always excludes past slots)
      const cutoff = new Date(Date.now() + minBookingLeadMinutes * 60_000);
      const effectiveStart = cutoff.toISOString();

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

  // Fetch all available slots across all bays for the selected date,
  // then group them by time
  const fetchTimeGroups = useCallback(
    async (date: string) => {
      setLoading(true);
      // Only clear selection if we're NOT restoring from localStorage
      if (!restoredFromStorage.current) {
        setSelectedTimeKeys(new Set());
        setSelectedBayIdForBooking("");
      }
      restoredFromStorage.current = false;

      // Enforce bookable window — don't fetch slots beyond the max date
      if (date > maxBookableDateStr) {
        setTimeGroups([]);
        setLoading(false);
        return;
      }

      const supabase = createClient();

      // Compute day boundaries in the facility timezone
      const nextDayStr = addDays(date, 1);
      const dayStart = toTimestamp(date, "00:00:00", timezone);
      const dayEnd = toTimestamp(nextDayStr, "00:00:00", timezone);

      // For today, exclude past slots (and respect lead time window)
      let effectiveStart = dayStart;
      if (date === todayStr) {
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

      // Build a map of bay_id → bay name for quick lookup
      const bayNameMap: Record<string, string> = {};
      for (const bay of bays) {
        bayNameMap[bay.id] = bay.name;
      }

      // Group slots by start_time across bays
      const groupMap = new Map<string, TimeGroup>();

      if (allSlots) {
        for (const slot of allSlots) {
          const slotBayId = scheduleToBay[slot.bay_schedule_id];
          if (!slotBayId) continue;
          const bayName = bayNameMap[slotBayId];
          if (!bayName) continue;

          const key = slot.start_time;
          let group = groupMap.get(key);
          if (!group) {
            group = {
              key,
              start_time: slot.start_time,
              end_time: slot.end_time,
              min_price_cents: slot.price_cents,
              all_same_price: true,
              available_bays: [],
            };
            groupMap.set(key, group);
          }

          group.available_bays.push({
            bay_id: slotBayId,
            bay_name: bayName,
            slot_id: slot.id,
            price_cents: slot.price_cents,
          });

          // Update price tracking
          if (slot.price_cents < group.min_price_cents) {
            group.min_price_cents = slot.price_cents;
          }
        }
      }

      // Finalize: check if all_same_price holds, sort bays by sort_order
      const bayOrderMap: Record<string, number> = {};
      bays.forEach((b, i) => { bayOrderMap[b.id] = i; });

      const groups = Array.from(groupMap.values())
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

      for (const group of groups) {
        const prices = group.available_bays.map((b) => b.price_cents);
        group.all_same_price = prices.every((p) => p === prices[0]);
        group.available_bays.sort((a, b) => (bayOrderMap[a.bay_id] ?? 0) - (bayOrderMap[b.bay_id] ?? 0));
      }

      setTimeGroups(groups);
      setLoading(false);
    },
    [orgId, timezone, todayStr, minBookingLeadMinutes, bays, maxBookableDateStr]
  );

  useEffect(() => {
    fetchTimeGroups(selectedDate);
  }, [selectedDate, fetchTimeGroups]);

  // Process pending booking action after time groups load
  useEffect(() => {
    if (!pendingBookingAction.current || loading || timeGroups.length === 0) return;
    const action = pendingBookingAction.current;
    pendingBookingAction.current = null;

    // Find the matching time group by formatted start_time
    const normalizeTime = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
    const requestedTime = normalizeTime(action.start_time);

    const matchedGroup = timeGroups.find((g) => {
      const formatted = normalizeTime(formatTime(g.start_time, timezone));
      return formatted === requestedTime;
    });

    if (!matchedGroup) return;

    // Find the matching bay in the group
    const matchedBay = matchedGroup.available_bays.find((b) =>
      b.bay_name.toLowerCase().includes(action.bay_name.toLowerCase())
    );

    // Select the time slot
    setSelectedTimeKeys(new Set([matchedGroup.key]));
    if (matchedBay) {
      setSelectedBayIdForBooking(matchedBay.bay_id);
    }
    // Open the booking panel
    setPanelOpen(true);
    setBookingStep(1);
  }, [loading, timeGroups, timezone]);

  // Handle booking action from chat assistant
  const handleBookingAction = useCallback(
    (action: BookingAction) => {
      // If we need to change the date, set it and store the action for later
      if (action.date !== selectedDate) {
        pendingBookingAction.current = action;
        setSelectedDate(action.date);
      } else {
        // Same date — time groups are already loaded, process immediately
        pendingBookingAction.current = action;
        // Trigger the effect by touching a dependency — the effect will run on next render
        // since we just set the ref. Force a re-render by setting loading momentarily.
        // Actually, just process inline since timeGroups are already available:
        const normalizeTime = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
        const requestedTime = normalizeTime(action.start_time);

        const matchedGroup = timeGroups.find((g) => {
          const formatted = normalizeTime(formatTime(g.start_time, timezone));
          return formatted === requestedTime;
        });

        if (matchedGroup) {
          const matchedBay = matchedGroup.available_bays.find((b) =>
            b.bay_name.toLowerCase().includes(action.bay_name.toLowerCase())
          );
          setSelectedTimeKeys(new Set([matchedGroup.key]));
          if (matchedBay) {
            setSelectedBayIdForBooking(matchedBay.bay_id);
          }
          setPanelOpen(true);
          setBookingStep(1);
          pendingBookingAction.current = null;
        }
      }
    },
    [selectedDate, timeGroups, timezone]
  );

  // Auto-open panel after restoring from localStorage (post-auth reload)
  useEffect(() => {
    if (mounted && selectedTimeKeys.size > 0 && isAuthenticated) {
      // Check if we just restored — the panel should open
      const stored = sessionStorage.getItem("playbook-panel-reopen");
      if (stored) {
        sessionStorage.removeItem("playbook-panel-reopen");
        setPanelOpen(true);
      }
    }
  }, [mounted, selectedTimeKeys.size, isAuthenticated]);

  function handleDateChange(delta: number) {
    const newDate = addDays(selectedDate, delta);
    if (newDate < todayStr) return;
    if (newDate > maxBookableDateStr) return;
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
    if (newDate > maxBookableDateStr) return;
    setSelectedDate(newDate);
    setCalendarOpen(false);
    setAutoAdvancedFrom(null);
  }

  // Compute eligible bays: bays that have slots for ALL selected time keys
  function getEligibleBays(keys: Set<string>): Array<{ bay_id: string; bay_name: string }> {
    if (keys.size === 0) return [];
    const keysArr = Array.from(keys);
    // For each time key, get the set of bay_ids that are available
    const baySetsPerKey = keysArr.map((key) => {
      const group = timeGroups.find((g) => g.key === key);
      return new Set(group?.available_bays.map((b) => b.bay_id) ?? []);
    });
    // Intersect all sets
    const intersection = baySetsPerKey.reduce((acc, set) => {
      return new Set([...acc].filter((id) => set.has(id)));
    });
    // Return bay info sorted by original bay order
    const bayOrderMap: Record<string, number> = {};
    bays.forEach((b, i) => { bayOrderMap[b.id] = i; });
    return Array.from(intersection)
      .map((id) => ({ bay_id: id, bay_name: bays.find((b) => b.id === id)?.name ?? "" }))
      .sort((a, b) => (bayOrderMap[a.bay_id] ?? 0) - (bayOrderMap[b.bay_id] ?? 0));
  }

  const eligibleBays = getEligibleBays(selectedTimeKeys);

  function toggleTimeSlot(key: string) {
    setSelectedTimeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      // Check if adding this key would still leave at least one eligible bay
      const candidate = new Set([...prev, key]);
      const eligible = getEligibleBays(candidate);
      if (eligible.length === 0) {
        // Can't add — no bay covers all selected times
        return prev;
      }
      next.add(key);
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
    // Reset checkout state
    setCheckoutIntent(null);
    setCheckoutLoading(false);
    setCheckoutError("");
    setPolicyAgreed(false);
    setPolicyAgreedAt(null);
    // Reset step wizard
    setBookingStep(1);
    setPaymentValidated(false);
    setPaymentValidationError("");
    setConfirmPolicyModalOpen(false);
    setCardBrand(null);
    setCardLast4(null);
    setConfirmedPaymentMethodId(null);
  }

  // Save selection to localStorage before auth reload
  function saveSelectionToStorage() {
    const data = {
      orgId,
      date: selectedDate,
      bayIdForBooking: effectiveBayId,
      timeKeys: Array.from(selectedTimeKeys),
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

  // Create checkout intent (PaymentIntent or SetupIntent) on the org's connected account
  async function createCheckoutIntent() {
    const slotIdsArray = selectedSlotInfo.map((s) => s.slot_id);
    setCheckoutLoading(true);
    setCheckoutError("");

    try {
      const res = await fetch("/api/stripe/create-checkout-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot_ids: slotIdsArray, location_id: locationId || null }),
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

  // Record booking payment after successful booking + payment
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
      // Non-critical: booking exists, payment confirmed in Stripe
      console.error("Failed to record booking payment");
    }
  }

  // Cancel/refund intent when booking fails after payment
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

  // Confirm booking — client-side via Supabase RPC
  async function handleConfirmBooking() {
    if (!userProfileId || !effectiveBayId) return;

    setBookingInProgress(true);
    setBookingError("");

    // If payment is required, use the already-confirmed payment method from step 2
    let paymentMethodId: string | undefined;
    if (requiresPayment && checkoutIntent) {
      if (!policyAgreedAt) {
        setPolicyAgreed(true);
        setPolicyAgreedAt(new Date().toISOString());
      }

      if (confirmedPaymentMethodId) {
        // Payment was already confirmed in step 2 via confirmAndGetCardInfo()
        paymentMethodId = confirmedPaymentMethodId;
      } else {
        // Fallback: confirm payment now (e.g., non-step flow)
        if (!checkoutFormRef.current) {
          setBookingError("Payment form not ready. Please try again.");
          setBookingInProgress(false);
          return;
        }
        const result = await checkoutFormRef.current.submit();
        if (!result.success) {
          setBookingError(result.error || "Payment failed. Please try again.");
          setBookingInProgress(false);
          return;
        }
        paymentMethodId = result.paymentMethodId;
      }
    }

    const supabase = createClient();
    const slotIdsArray = selectedSlotInfo.map((s) => s.slot_id);

    // Re-validate slot availability
    const { data: freshSlots } = await supabase
      .from("bay_schedule_slots")
      .select("id, status")
      .in("id", slotIdsArray);

    const unavailable = freshSlots?.filter((s) => s.status !== "available") || [];
    if (unavailable.length > 0) {
      // Slots taken after payment — cancel/refund the intent
      if (requiresPayment && checkoutIntent) {
        await cancelIntent();
        setCheckoutIntent(null);
        setPolicyAgreed(false);
        setPolicyAgreedAt(null);
      }
      setBookingError("One or more selected slots are no longer available. Please close and select different time slots." +
        (requiresPayment ? " Your payment has been cancelled." : ""));
      setBookingInProgress(false);
      return;
    }

    // Calculate membership discount
    const totalCentsForDiscount = selectedSlotInfo.reduce((sum, s) => sum + s.price_cents, 0);
    const { discountCents: bookingDiscountCents, label: bookingDiscountLabel } = calcDiscount(totalCentsForDiscount);

    // Create the booking via RPC
    const { data, error } = await supabase.rpc("create_booking", {
      p_org_id: orgId,
      p_customer_id: userProfileId,
      p_bay_id: effectiveBayId,
      p_date: selectedDate,
      p_slot_ids: slotIdsArray,
      p_notes: notes || null,
      p_location_id: locationId || null,
      p_discount_cents: bookingDiscountCents || 0,
      p_discount_description: bookingDiscountLabel || null,
    });

    if (error) {
      // Booking failed after payment — cancel/refund
      if (requiresPayment && checkoutIntent) {
        await cancelIntent();
        setCheckoutIntent(null);
        setPolicyAgreed(false);
        setPolicyAgreedAt(null);
      }

      // Show friendly message for slot-conflict errors instead of raw DB errors
      const msg = error.message;
      if (
        msg.includes("booking_slots_slot_unique") ||
        msg.includes("no longer available") ||
        msg.includes("not available")
      ) {
        setBookingError(
          "One or more selected slots are no longer available. Please close and select different time slots." +
          (requiresPayment ? " Your payment has been refunded." : "")
        );
      } else {
        setBookingError(msg + (requiresPayment ? " Your payment has been refunded." : ""));
      }
      setBookingInProgress(false);
      // Refresh availability so stale slots disappear
      fetchTimeGroups(selectedDate);
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

    // Record booking payment (fire-and-forget for each booking)
    if (requiresPayment && checkoutIntent) {
      for (const br of bookingResults) {
        recordBookingPayment(br.booking_id, paymentMethodId);
      }
    }

    // Trigger booking notifications (fire-and-forget)
    for (const br of bookingResults) {
      fireNotification("confirmed", {
        bookingId: br.booking_id,
        confirmationCode: br.confirmation_code,
      });
    }

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
    setSelectedTimeKeys(new Set());
    setSelectedBayIdForBooking("");
    setNotes("");
    setBookingInProgress(false);
    setCheckoutIntent(null);
    setPolicyAgreed(false);
    setPolicyAgreedAt(null);

    // Show toast
    setToastData({
      message: "Booking Confirmed!",
      description: `Confirmation ${codes.length > 1 ? "codes" : "code"}: ${codes.join(", ")}`,
    });

    // Highlight new bookings in sidebar
    setHighlightedBookingIds(new Set(newBookingIds));
    setTimeout(() => setHighlightedBookingIds(new Set()), 8000);

    // Refresh time groups (booked slots should disappear) and bookings list
    fetchTimeGroups(selectedDate);
    fetchBookings();
  }

  // Confirm guest booking — admin creates on behalf of a guest
  async function handleConfirmGuestBooking() {
    if (!guestName.trim() || !effectiveBayId) return;

    setBookingInProgress(true);
    setBookingError("");

    const supabase = createClient();
    const slotIdsArray = selectedSlotInfo.map((s) => s.slot_id);

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
      p_bay_id: effectiveBayId,
      p_date: selectedDate,
      p_slot_ids: slotIdsArray,
      p_guest_name: guestName.trim(),
      p_guest_email: guestEmail.trim() || null,
      p_guest_phone: guestPhone.trim() || null,
      p_notes: notes || null,
    });

    if (error) {
      const msg = error.message;
      if (
        msg.includes("booking_slots_slot_unique") ||
        msg.includes("no longer available") ||
        msg.includes("not available")
      ) {
        setBookingError(
          "One or more selected slots are no longer available. Please close and select different time slots."
        );
      } else {
        setBookingError(msg);
      }
      setBookingInProgress(false);
      fetchTimeGroups(selectedDate);
      return;
    }

    const bookingResults = Array.isArray(data) ? data : [data];
    const codes = bookingResults.map(
      (r: { confirmation_code: string }) => r.confirmation_code
    );

    // Trigger guest booking notifications (fire-and-forget)
    for (const br of bookingResults) {
      fireNotification("confirmed", {
        bookingId: br.booking_id,
        confirmationCode: br.confirmation_code,
      });
    }

    // Redirect back to admin bookings with success message
    router.push(`/admin/bookings?guest_booked=true&codes=${codes.join(",")}`);
  }

  // Confirm modification — cancel old booking and create new one atomically
  async function handleConfirmModification() {
    if (!originalBooking || !effectiveBayId) return;

    setBookingInProgress(true);
    setBookingError("");

    const supabase = createClient();
    const slotIdsArray = selectedSlotInfo.map((s) => s.slot_id);

    // Detect "no changes" — same bay, same slots
    const oldSlotsSorted = [...originalBooking.slotIds].sort();
    const newSlotsSorted = [...slotIdsArray].sort();
    if (
      effectiveBayId === originalBooking.bayId &&
      oldSlotsSorted.length === newSlotsSorted.length &&
      oldSlotsSorted.every((s, i) => s === newSlotsSorted[i])
    ) {
      setBookingError("No changes detected. Select different slots or a different facility to modify your booking.");
      setBookingInProgress(false);
      return;
    }

    const rpcName = originalBooking.isGuest ? "modify_guest_booking" : "modify_booking";
    const { data, error } = await supabase.rpc(rpcName, {
      p_booking_id: originalBooking.id,
      p_new_bay_id: effectiveBayId,
      p_new_date: selectedDate,
      p_new_slot_ids: slotIdsArray,
      p_notes: notes || null,
    });

    if (error) {
      setBookingError(error.message);
      setBookingInProgress(false);
      return;
    }

    const result = data as {
      booking_id: string;
      confirmation_code: string;
      old_confirmation_code: string;
      total_price_cents: number;
    };

    // Handle payment adjustments for modified bookings
    if (paymentMode !== "none" && result.booking_id) {
      try {
        const payRes = await fetch("/api/stripe/modify-booking-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            old_booking_id: originalBooking.id,
            new_booking_id: result.booking_id,
            new_amount_cents: totalCents,
          }),
        });

        if (payRes.ok) {
          const payData = await payRes.json();
          if (payData.status === "requires_action" && payData.client_secret) {
            // Off-session charge requires 3DS — for now we proceed with a warning
            // The admin can handle the remaining charge manually
            console.warn("Modification payment requires additional authentication");
          }
        }
      } catch {
        // Non-critical: booking is modified, payment adjustment can be handled by admin
        console.error("Failed to adjust payment for modification");
      }
    }

    // Trigger modification notification (fire-and-forget)
    fireNotification("modified", {
      confirmationCode: result.confirmation_code,
      oldConfirmationCode: result.old_confirmation_code,
    });

    const redirectBase = modifyRedirectBase || "/my-bookings";
    const facilityParam = facilitySlug ? `&facility=${facilitySlug}` : "";
    router.push(
      `${redirectBase}?modified=true&old=${result.old_confirmation_code}&new=${result.confirmation_code}${facilityParam}`
    );
  }

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
      fireNotification("canceled", { bookingId });
      setBookings((prev) => prev.filter((b) => b.id !== bookingId));
      setSidebarModalOpen(false);
      setSidebarBooking(null);
      fetchTimeGroups(selectedDate);
    }
  }

  // Auto-select the first eligible bay when selection changes
  const effectiveBayId = eligibleBays.some((b) => b.bay_id === selectedBayIdForBooking)
    ? selectedBayIdForBooking
    : eligibleBays[0]?.bay_id ?? "";

  // Resolve actual slot info for the effective bay and selected time keys
  function getSelectedSlotInfo(bayId: string) {
    const result: Array<{ slot_id: string; start_time: string; end_time: string; price_cents: number }> = [];
    for (const key of selectedTimeKeys) {
      const group = timeGroups.find((g) => g.key === key);
      if (!group) continue;
      const baySlot = group.available_bays.find((b) => b.bay_id === bayId);
      if (baySlot) {
        result.push({
          slot_id: baySlot.slot_id,
          start_time: group.start_time,
          end_time: group.end_time,
          price_cents: baySlot.price_cents,
        });
      }
    }
    return result.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }

  function getBayTotalCents(bayId: string): number {
    return getSelectedSlotInfo(bayId).reduce((sum, s) => sum + s.price_cents, 0);
  }

  const selectedSlotInfo = getSelectedSlotInfo(effectiveBayId);
  const totalCents = selectedSlotInfo.reduce((sum, s) => sum + s.price_cents, 0);

  const selectedBayObj = bays.find((b) => b.id === effectiveBayId);

  // Check if earliest selected slot is within the cancellation window
  const isWithinCancellationWindow = (() => {
    if (paymentMode === "none" || selectedSlotInfo.length === 0) return false;
    const earliest = selectedSlotInfo[0]; // already sorted by start_time
    const startMs = new Date(earliest.start_time).getTime();
    const cutoff = startMs - cancellationWindowHours * 60 * 60 * 1000;
    return Date.now() >= cutoff;
  })();

  // Group consecutive selected slots for display in the confirm panel
  const selectedGroups: Array<{ start_time: string; end_time: string; price_cents: number; slot_count: number }> = [];
  for (const slot of selectedSlotInfo) {
    const last = selectedGroups[selectedGroups.length - 1];
    if (last && new Date(slot.start_time).getTime() === new Date(last.end_time).getTime()) {
      last.end_time = slot.end_time;
      last.price_cents += slot.price_cents;
      last.slot_count += 1;
    } else {
      selectedGroups.push({
        start_time: slot.start_time,
        end_time: slot.end_time,
        price_cents: slot.price_cents,
        slot_count: 1,
      });
    }
  }

  const isAdminGuest = mode === "admin-guest";
  const hideSidebar = isAdminGuest || isModify;

  return (
    <div className={hideSidebar ? "" : "flex items-start gap-6"}>
      {/* ===== Sidebar — Confirmed Bookings + Chat Assistant (desktop only, hidden in admin-guest/modify mode) ===== */}
      {!hideSidebar && (
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
                  onBookingAction={handleBookingAction}
                />
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* ===== Main content ===== */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* Location Switcher (multi-location orgs only) */}
        {locationsEnabled && locations.length > 1 && locationId && (
          <div className="flex items-center gap-2 border-b px-5 py-2.5">
            <LocationSwitcher
              locations={locations}
              activeLocationId={locationId}
            />
          </div>
        )}
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
                disabled={{
                  before: new Date(todayStr + "T12:00:00"),
                  after: new Date(maxBookableDateStr + "T12:00:00"),
                }}
                startMonth={new Date(todayStr + "T12:00:00")}
                endMonth={new Date(maxBookableDateStr + "T12:00:00")}
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

        {/* Time Slot List */}
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : timeGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Clock className="mb-3 h-10 w-10 text-muted-foreground/30" />
              <p className="font-medium text-muted-foreground">
                No available slots
              </p>
              <p className="mt-1 text-sm text-muted-foreground/70">
                No availability on {formatShortDate(selectedDate)}. Try another date.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {timeGroups.map((group) => {
                const startTime = formatTime(group.start_time, timezone);
                const endTime = formatTime(group.end_time, timezone);
                const priceLabel = group.all_same_price
                  ? `$${(group.min_price_cents / 100).toFixed(2)}`
                  : `from $${(group.min_price_cents / 100).toFixed(2)}`;
                const isSelected = selectedTimeKeys.has(group.key);

                // Check if this slot could be added (at least one bay in common with current selection)
                const wouldBeEligible = isSelected || (() => {
                  if (selectedTimeKeys.size === 0) return true;
                  const candidate = new Set([...selectedTimeKeys, group.key]);
                  return getEligibleBays(candidate).length > 0;
                })();

                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => toggleTimeSlot(group.key)}
                    disabled={!wouldBeEligible}
                    className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : !wouldBeEligible
                          ? "cursor-not-allowed opacity-40"
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
                        <div className="mt-0.5 flex flex-wrap gap-1.5">
                          {group.available_bays.map((b) => (
                            <span
                              key={b.bay_id}
                              className="inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                            >
                              {b.bay_name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold">{priceLabel}</span>
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
      {selectedTimeKeys.size > 0 &&
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
                      {selectedTimeKeys.size} slot
                      {selectedTimeKeys.size !== 1 ? "s" : ""} selected
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Total: ${(calcDiscount(totalCents).finalCents / 100).toFixed(2)}
                      {calcDiscount(totalCents).discountCents > 0 && (
                        <span className="ml-1 text-teal-600 dark:text-teal-400">(member price)</span>
                      )}
                      {selectedBayObj && eligibleBays.length > 1 && (
                        <> &middot; {selectedBayObj.name}</>
                      )}
                    </p>
                  </div>
                  <Button onClick={handleOpenPanel} className="gap-2">
                    {isModify ? "Review Changes" : "Continue to Book"}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                /* ---- Expanded booking panel ---- */
                <div className="mx-auto max-w-lg px-6 py-6">
                  {/* Panel header — sticky for authenticated step flow */}
                  {(() => {
                    const isAuthStepFlow = isAuthenticated && !isModify && mode !== "admin-guest";
                    const totalSteps = requiresPayment ? 3 : 2;
                    const stepLabels = requiresPayment
                      ? ["Select Facility", "Payment Method", "Confirm Booking"]
                      : ["Select Facility", "Confirm Booking"];
                    const timeRangeStr = selectedSlotInfo.length > 0
                      ? `${formatTime(selectedSlotInfo[0].start_time, timezone)} – ${formatTime(selectedSlotInfo[selectedSlotInfo.length - 1].end_time, timezone)}`
                      : "";
                    const shortDateStr = new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

                    return (
                      <div className={isAuthStepFlow ? "sticky top-0 z-10 -mx-6 bg-background px-6 pb-4 pt-0" : "mb-6"}>
                        <div className="flex items-center justify-between">
                          <div>
                            <h2 className="text-lg font-bold">
                              {isModify ? "Review Modification" : "Confirm Booking"}
                            </h2>
                            <p className="text-sm text-muted-foreground">
                              {isModify && originalBooking
                                ? `Modifying ${formatTime(originalBooking.startTime, timezone)} – ${formatTime(originalBooking.endTime, timezone)}, ${new Date(originalBooking.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${originalBooking.bayName}`
                                : isAuthStepFlow && timeRangeStr
                                  ? `${shortDateStr} · ${timeRangeStr}`
                                  : formatDateLabel(selectedDate)}
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

                        {/* Step indicator — only for authenticated step flow */}
                        {isAuthStepFlow && (
                          <div className="mt-3 flex items-center gap-1">
                            {stepLabels.map((label, i) => {
                              const stepNum = i + 1;
                              const isCurrent = bookingStep === stepNum;
                              const isCompleted = bookingStep > stepNum;
                              // Allow going back to step 1 always; never back to step 2 once confirmed
                              const canNavigate = isCompleted && !(confirmedPaymentMethodId && stepNum === 2);
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
                                      // Going back to step 1 resets payment state
                                      if (stepNum === 1 && requiresPayment && confirmedPaymentMethodId) {
                                        setPaymentValidated(false);
                                        setPaymentValidationError("");
                                        setConfirmedPaymentMethodId(null);
                                        setCardBrand(null);
                                        setCardLast4(null);
                                        setCheckoutIntent(null);
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
                                      <Check className="h-3 w-3 text-green-600" strokeWidth={3} />
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
                    );
                  })()}

                  {isModify && originalBooking ? (
                    /* ---- Modify booking: old-vs-new comparison + confirm ---- */
                    <div>
                      {/* Error banner */}
                      {bookingError && (
                        <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                          {bookingError}
                        </div>
                      )}

                      {/* Bay selector */}
                      {eligibleBays.length > 1 && (
                        <div className="mb-4">
                          <p className="mb-2 text-sm font-medium">Select Facility</p>
                          <div className="space-y-2">
                            {eligibleBays.map((bay) => (
                              <label
                                key={bay.bay_id}
                                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                                  effectiveBayId === bay.bay_id
                                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                                    : "hover:bg-accent"
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="bay-select-modify"
                                  value={bay.bay_id}
                                  checked={effectiveBayId === bay.bay_id}
                                  onChange={() => setSelectedBayIdForBooking(bay.bay_id)}
                                  className="sr-only"
                                />
                                <div
                                  className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                    effectiveBayId === bay.bay_id
                                      ? "border-primary"
                                      : "border-muted-foreground/30"
                                  }`}
                                >
                                  {effectiveBayId === bay.bay_id && (
                                    <div className="h-2 w-2 rounded-full bg-primary" />
                                  )}
                                </div>
                                <span className="text-sm font-medium">{bay.bay_name}</span>
                                <span className="ml-auto text-sm text-muted-foreground">
                                  ${(getBayTotalCents(bay.bay_id) / 100).toFixed(2)}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Old vs New comparison */}
                      <div className="mb-4 grid grid-cols-2 gap-3">
                        {/* Original booking */}
                        <div className="rounded-lg border border-muted p-3">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Current Booking
                          </p>
                          <p className="text-sm font-medium">{originalBooking.bayName}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {new Date(originalBooking.date + "T12:00:00").toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatTime(originalBooking.startTime, timezone)} &ndash;{" "}
                            {formatTime(originalBooking.endTime, timezone)}
                          </p>
                          <p className="mt-2 text-sm font-semibold">
                            ${(originalBooking.totalPriceCents / 100).toFixed(2)}
                          </p>
                        </div>

                        {/* New booking */}
                        <div className="rounded-lg border border-primary/50 bg-primary/5 p-3">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-primary">
                            New Booking
                          </p>
                          <p className="text-sm font-medium">{selectedBayObj?.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </p>
                          {selectedGroups.map((group) => (
                            <p key={group.start_time} className="text-xs text-muted-foreground">
                              {formatTime(group.start_time, timezone)} &ndash;{" "}
                              {formatTime(group.end_time, timezone)}
                            </p>
                          ))}
                          <p className="mt-2 text-sm font-semibold">
                            ${(totalCents / 100).toFixed(2)}
                          </p>
                        </div>
                      </div>

                      {/* Price difference */}
                      {totalCents !== originalBooking.totalPriceCents && (
                        <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
                          totalCents > originalBooking.totalPriceCents
                            ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
                            : "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400"
                        }`}>
                          Price {totalCents > originalBooking.totalPriceCents ? "increase" : "decrease"}:{" "}
                          <span className="font-semibold">
                            {totalCents > originalBooking.totalPriceCents ? "+" : "-"}$
                            {(Math.abs(totalCents - originalBooking.totalPriceCents) / 100).toFixed(2)}
                          </span>
                        </div>
                      )}

                      {/* Notes */}
                      <div className="mb-4 space-y-2">
                        <Label htmlFor="modify-booking-notes">Notes (optional)</Label>
                        <Input
                          id="modify-booking-notes"
                          placeholder="Any special requests..."
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                        />
                      </div>

                      {/* Confirm button */}
                      <Button
                        className="w-full"
                        size="lg"
                        disabled={bookingInProgress}
                        onClick={handleConfirmModification}
                      >
                        {bookingInProgress ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Modifying...
                          </>
                        ) : (
                          "Confirm Modification"
                        )}
                      </Button>
                    </div>
                  ) : isAdminGuest ? (
                    /* ---- Admin guest booking: guest info form + confirm ---- */
                    <div>
                      {/* Error banner */}
                      {bookingError && (
                        <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                          {bookingError}
                        </div>
                      )}

                      {/* Bay selector */}
                      {eligibleBays.length > 1 && (
                        <div className="mb-4">
                          <p className="mb-2 text-sm font-medium">Select Facility</p>
                          <div className="space-y-2">
                            {eligibleBays.map((bay) => (
                              <label
                                key={bay.bay_id}
                                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                                  effectiveBayId === bay.bay_id
                                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                                    : "hover:bg-accent"
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="bay-select-guest"
                                  value={bay.bay_id}
                                  checked={effectiveBayId === bay.bay_id}
                                  onChange={() => setSelectedBayIdForBooking(bay.bay_id)}
                                  className="sr-only"
                                />
                                <div
                                  className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                    effectiveBayId === bay.bay_id
                                      ? "border-primary"
                                      : "border-muted-foreground/30"
                                  }`}
                                >
                                  {effectiveBayId === bay.bay_id && (
                                    <div className="h-2 w-2 rounded-full bg-primary" />
                                  )}
                                </div>
                                <span className="text-sm font-medium">{bay.bay_name}</span>
                                <span className="ml-auto text-sm text-muted-foreground">
                                  ${(getBayTotalCents(bay.bay_id) / 100).toFixed(2)}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Booking summary */}
                      <div className="mb-4 rounded-lg border p-4">
                        <div className="mb-3">
                          <p className="font-medium">{selectedBayObj?.name}</p>
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
                          {(() => {
                            const disc = calcDiscount(totalCents);
                            return (
                              <>
                                {disc.discountCents > 0 && (
                                  <div className="mb-1 flex items-center justify-between text-sm text-teal-600 dark:text-teal-400">
                                    <span className="flex items-center gap-1">
                                      <Crown className="h-3.5 w-3.5" />
                                      {disc.label}
                                    </span>
                                    <span>-${(disc.discountCents / 100).toFixed(2)}</span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between font-bold">
                                  <span>Total</span>
                                  <span>${(disc.finalCents / 100).toFixed(2)}</span>
                                </div>
                              </>
                            );
                          })()}
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
                            <p className="text-sm font-medium">{selectedBayObj?.name ?? "Facility"}</p>
                            <p className="text-xs text-muted-foreground">
                              {selectedTimeKeys.size} slot{selectedTimeKeys.size !== 1 ? "s" : ""}
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
                                <Label htmlFor="panel-signup-phone">
                                  Phone Number{" "}
                                  <span className="text-muted-foreground font-normal">(optional)</span>
                                </Label>
                                <Input
                                  id="panel-signup-phone"
                                  type="tel"
                                  placeholder="(555) 123-4567"
                                  value={signUpPhone}
                                  onChange={(e) => setSignUpPhone(e.target.value)}
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
                    /* ---- Authenticated: Multi-step booking wizard ---- */
                    <div>
                      {/* Error banner */}
                      {bookingError && (
                        <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                          {bookingError}
                        </div>
                      )}

                      {/* ═══ Step 1: Facility ═══ */}
                      {bookingStep === 1 && (
                        <div>
                          {/* Bay selector */}
                          {eligibleBays.length > 1 && (
                            <div className="mb-4">
                              <p className="mb-2 text-sm font-medium">Select Facility</p>
                              <div className="space-y-2">
                                {eligibleBays.map((bay) => (
                                  <label
                                    key={bay.bay_id}
                                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                                      effectiveBayId === bay.bay_id
                                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                                        : "hover:bg-accent"
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name="bay-select-auth"
                                      value={bay.bay_id}
                                      checked={effectiveBayId === bay.bay_id}
                                      onChange={() => {
                                        setSelectedBayIdForBooking(bay.bay_id);
                                        // Invalidate checkout intent since slot IDs depend on the bay
                                        if (checkoutIntent) {
                                          setCheckoutIntent(null);
                                          setPaymentValidated(false);
                                          setCardBrand(null);
                                          setCardLast4(null);
                                          setConfirmedPaymentMethodId(null);
                                        }
                                      }}
                                      className="sr-only"
                                    />
                                    <div
                                      className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                        effectiveBayId === bay.bay_id
                                          ? "border-primary"
                                          : "border-muted-foreground/30"
                                      }`}
                                    >
                                      {effectiveBayId === bay.bay_id && (
                                        <div className="h-2 w-2 rounded-full bg-primary" />
                                      )}
                                    </div>
                                    <span className="text-sm font-medium">{bay.bay_name}</span>
                                    <span className="ml-auto text-sm text-muted-foreground">
                                      ${(getBayTotalCents(bay.bay_id) / 100).toFixed(2)}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Booking summary */}
                          <div className="mb-4 rounded-lg border p-4">
                            <div className="mb-3">
                              <p className="font-medium">{selectedBayObj?.name}</p>
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
                              {(() => {
                                const disc = calcDiscount(totalCents);
                                return disc.discountCents > 0 ? (
                                  <div className="mb-1 flex items-center justify-between text-sm text-teal-600 dark:text-teal-400">
                                    <span className="flex items-center gap-1">
                                      <Crown className="h-3.5 w-3.5" />
                                      {disc.label}
                                    </span>
                                    <span>-${(disc.discountCents / 100).toFixed(2)}</span>
                                  </div>
                                ) : null;
                              })()}
                              <div className="flex items-center justify-between font-bold">
                                <span>Total</span>
                                <span>${(calcDiscount(totalCents).finalCents / 100).toFixed(2)}</span>
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

                          {/* Guest upsell nudge */}
                          {membership?.membershipEnabled && !membership.isMember && isAuthenticated && (
                            <a
                              href="/membership"
                              className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
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
                              if (requiresPayment) {
                                // Advance to payment step
                                setBookingStep(2);
                                setPaymentValidationError("");
                                if (!checkoutIntent && !checkoutLoading) {
                                  createCheckoutIntent();
                                }
                              } else {
                                // No payment — skip directly to confirm step (step 2)
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
                      {/* Stripe Elements must stay mounted across steps 2 & 3 so submit() works on confirm.
                          We render the full payment step but hide it when not active. */}
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
                                  setPaymentValidationError("Payment form not ready. Please try again.");
                                  return;
                                }
                                // Confirm payment and extract card info in one step
                                const result = await checkoutFormRef.current.confirmAndGetCardInfo();
                                if (!result.success) {
                                  setPaymentValidationError(result.error || "Please check your payment details.");
                                  return;
                                }
                                setPaymentValidated(true);
                                if (result.paymentMethodId) setConfirmedPaymentMethodId(result.paymentMethodId);

                                // Get card brand + last4
                                let brand = result.cardBrand;
                                let last4 = result.cardLast4;

                                // If card details not returned (payment_method was a string ID),
                                // fetch from server
                                if (result.paymentMethodId && (!brand || !last4)) {
                                  try {
                                    const res = await fetch(`/api/stripe/card-details?pm=${result.paymentMethodId}`);
                                    if (res.ok) {
                                      const data = await res.json();
                                      brand = data.brand || brand;
                                      last4 = data.last4 || last4;
                                    }
                                  } catch {
                                    // Non-critical — fallback text will show
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

                      {/* ═══ Step 2 (no payment) / Step 3 (with payment): Confirm ═══ */}
                      {((bookingStep === 2 && !requiresPayment) ||
                        (bookingStep === 3 && requiresPayment)) && (
                        <div>
                          {/* Summary card */}
                          <div className="mb-4 space-y-3 rounded-lg border p-4">
                            {/* Date & time */}
                            <div className="flex items-center gap-2 text-sm">
                              <CalendarCheck className="h-4 w-4 text-muted-foreground" />
                              <span>
                                {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                {" · "}
                                {selectedSlotInfo.length > 0
                                  ? `${formatTime(selectedSlotInfo[0].start_time, timezone)} – ${formatTime(selectedSlotInfo[selectedSlotInfo.length - 1].end_time, timezone)}`
                                  : ""}
                              </span>
                            </div>

                            {/* Facility */}
                            <div className="flex items-center gap-2 text-sm">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              <span>{selectedBayObj?.name}</span>
                            </div>

                            {/* Payment method (if applicable) */}
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

                            {/* Total */}
                            {(() => {
                              const disc = calcDiscount(totalCents);
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
                                  <div className={`flex items-center justify-between text-sm font-bold ${disc.discountCents > 0 ? "pt-1" : "border-t pt-3"}`}>
                                    <span>Total</span>
                                    <span>${(disc.finalCents / 100).toFixed(2)}</span>
                                  </div>
                                </>
                              );
                            })()}
                          </div>

                          {/* Notes (if provided) */}
                          {notes && (
                            <div className="mb-4 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                              <span className="font-medium text-foreground">Note:</span> {notes}
                            </div>
                          )}

                          {/* Terms + cancellation policy */}
                          <p className="mb-2 text-xs text-muted-foreground text-center">
                            By booking you agree to the terms and{" "}
                            {checkoutIntent?.cancellation_policy_text ? (
                              <button
                                type="button"
                                onClick={() => setConfirmPolicyModalOpen(true)}
                                className="underline underline-offset-2 hover:text-foreground transition-colors"
                              >
                                cancellation policy
                              </button>
                            ) : (
                              "cancellation policy"
                            )}
                          </p>

                          {/* Cancellation policy modal */}
                          {checkoutIntent?.cancellation_policy_text && (
                            <Dialog open={confirmPolicyModalOpen} onOpenChange={setConfirmPolicyModalOpen}>
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
                                Booking is less than {cancellationWindowHours}h away and cannot be refunded or modified.
                              </p>
                            </div>
                          )}

                          {/* Navigation + Confirm */}
                          <div className="flex gap-3">
                            <Button
                              variant="outline"
                              onClick={() => {
                                // Always go back to step 1 — resets payment state
                                // so a fresh intent is created when re-entering step 2
                                setBookingStep(1);
                                if (requiresPayment) {
                                  setPaymentValidated(false);
                                  setPaymentValidationError("");
                                  setConfirmedPaymentMethodId(null);
                                  setCardBrand(null);
                                  setCardLast4(null);
                                  setCheckoutIntent(null);
                                }
                              }}
                            >
                              <ArrowLeft className="mr-2 h-4 w-4" />
                              Back
                            </Button>
                            <Button
                              className="flex-1"
                              size="lg"
                              disabled={bookingInProgress}
                              onClick={handleConfirmBooking}
                            >
                              {bookingInProgress ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  {requiresPayment && paymentMode === "charge_upfront"
                                    ? "Processing payment..."
                                    : requiresPayment
                                      ? "Saving card..."
                                      : "Booking..."}
                                </>
                              ) : requiresPayment && paymentMode === "charge_upfront" ? (
                                `Confirm & Pay $${(calcDiscount(totalCents).finalCents / 100).toFixed(2)}`
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
