"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  BookingDetailsModal,
  type BookingDetailData,
} from "@/components/booking-details-modal";
import {
  formatTimeInZone,
  getVisualBookingStatus,
  type VisualBookingStatus,
} from "@/lib/utils";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ArrowRight, ChevronUp, ChevronDown, Filter, Loader2 } from "lucide-react";

function getStatusBadge(visualStatus: VisualBookingStatus) {
  switch (visualStatus) {
    case "active":
      return {
        className:
          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
        label: "active",
        pulse: true,
      };
    case "confirmed":
      return {
        className:
          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
        label: "confirmed",
        pulse: false,
      };
    case "completed":
      return {
        className:
          "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400",
        label: "completed",
        pulse: false,
      };
    case "cancelled":
      return {
        className:
          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
        label: "cancelled",
        pulse: false,
      };
  }
}

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
  status: string;
  confirmation_code: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  customer_id: string | null;
  bay_id: string;
  is_guest: boolean;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  modified_from: string | null;
  modified_from_info?: ModifiedFromInfo | null;
};

type TabContext =
  | "upcoming"
  | "completed"
  | "canceled-future"
  | "canceled-past";

type SortField = "booked_for" | "created_at";
type SortDirection = "asc" | "desc";

type Props = {
  bookings: Booking[];
  bayMap: Record<string, string>;
  customerMap: Record<string, { full_name: string | null; email: string }>;
  timezone: string;
  orgId: string;
  initialBookingCode?: string | null;
  cancelAction: (formData: FormData) => Promise<void>;
  cancellationWindowHours?: number;
  paymentMode?: string;
  bays: { id: string; name: string }[];
  tabContext: TabContext;
  showCanceledAt?: boolean;
  initialFromDate?: string;
};

function getCustomerDisplay(
  booking: Booking,
  customerMap: Record<string, { full_name: string | null; email: string }>
) {
  if (booking.is_guest) {
    return {
      name: booking.guest_name || "Guest",
      email: booking.guest_email || null,
      isGuest: true,
    };
  }
  const c = booking.customer_id ? customerMap[booking.customer_id] : null;
  return {
    name: c?.full_name || c?.email || "Unknown",
    email: c?.full_name ? c.email : null,
    isGuest: false,
  };
}

function updateBookingUrl(code: string | null) {
  const url = new URL(window.location.href);
  if (code) {
    url.searchParams.set("booking", code);
  } else {
    url.searchParams.delete("booking");
  }
  window.history.replaceState(null, "", url.toString());
}

function formatDateTimeInZone(timestamp: string, timezone: string): string {
  const d = new Date(timestamp);
  const datePart = d.toLocaleDateString("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
  });
  const timePart = d.toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart}, ${timePart}`;
}

function getDateDaysAgo(fromDate: string, days: number): string {
  const d = new Date(fromDate + "T12:00:00");
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

// Sort arrow button component for column headers
function SortArrows({
  field,
  activeField,
  activeDirection,
  onSort,
}: {
  field: SortField;
  activeField: SortField;
  activeDirection: SortDirection;
  onSort: (field: SortField, dir: SortDirection) => void;
}) {
  const isActive = activeField === field;
  return (
    <span className="ml-1 inline-flex flex-col -space-y-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSort(field, "asc");
        }}
        className={`rounded p-0.5 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 ${
          isActive && activeDirection === "asc"
            ? "text-blue-600 dark:text-blue-400"
            : "text-gray-300 dark:text-gray-600"
        }`}
        title={
          field === "booked_for" ? "Closest to now" : "Most recent first"
        }
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSort(field, "desc");
        }}
        className={`rounded p-0.5 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 ${
          isActive && activeDirection === "desc"
            ? "text-blue-600 dark:text-blue-400"
            : "text-gray-300 dark:text-gray-600"
        }`}
        title={
          field === "booked_for" ? "Farthest from now" : "Oldest first"
        }
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

export function AdminBookingsList({
  bookings,
  bayMap,
  customerMap,
  timezone,
  orgId,
  initialBookingCode,
  cancelAction,
  cancellationWindowHours = 24,
  paymentMode = "none",
  bays,
  tabContext,
  showCanceledAt = false,
  initialFromDate = "",
}: Props) {
  const [selectedBooking, setSelectedBooking] =
    useState<BookingDetailData | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [filterNotice, setFilterNotice] = useState<string | null>(null);
  const [autoOpenedCode, setAutoOpenedCode] = useState<string | null>(null);

  // Sort state — default: "booked_for" asc (up arrow = closest to now)
  const isFutureFacing =
    tabContext === "upcoming" || tabContext === "canceled-future";
  const defaultSortDir: SortDirection = isFutureFacing ? "asc" : "desc";
  const [sortField, setSortField] = useState<SortField>("booked_for");
  const [sortDirection, setSortDirection] =
    useState<SortDirection>(defaultSortDir);

  // Facility filter state
  const [selectedBayIds, setSelectedBayIds] = useState<Set<string>>(
    new Set()
  );

  // Load more state (for completed + canceled-past)
  const hasLoadMore =
    tabContext === "completed" || tabContext === "canceled-past";
  const [extraBookings, setExtraBookings] = useState<Booking[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [loadMoreCursor, setLoadMoreCursor] = useState(() => {
    if (initialFromDate) return getDateDaysAgo(initialFromDate, 1);
    return "";
  });

  // Reset extra bookings when props change (tab switch causes remount so this
  // is mainly a safety net)
  useEffect(() => {
    setExtraBookings([]);
    setAllLoaded(false);
    if (initialFromDate) {
      setLoadMoreCursor(getDateDaysAgo(initialFromDate, 1));
    }
  }, [tabContext, initialFromDate]);

  // Reset sort when tab changes
  useEffect(() => {
    setSortField("booked_for");
    setSortDirection(isFutureFacing ? "asc" : "desc");
    setSelectedBayIds(new Set());
  }, [tabContext, isFutureFacing]);

  // Combined bookings (server-rendered + loaded more)
  const allBookings = useMemo(
    () => [...bookings, ...extraBookings],
    [bookings, extraBookings]
  );

  // Apply facility filter
  const filteredByBay = useMemo(() => {
    if (selectedBayIds.size === 0) return allBookings;
    return allBookings.filter((b) => selectedBayIds.has(b.bay_id));
  }, [allBookings, selectedBayIds]);

  // Apply sort
  const sorted = useMemo(() => {
    const arr = [...filteredByBay];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortField === "booked_for") {
        cmp =
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
      } else {
        cmp =
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filteredByBay, sortField, sortDirection]);

  function handleSort(field: SortField, dir: SortDirection) {
    setSortField(field);
    setSortDirection(dir);
  }

  function toggleBayFilter(bayId: string) {
    setSelectedBayIds((prev) => {
      const next = new Set(prev);
      if (next.has(bayId)) {
        next.delete(bayId);
      } else {
        next.add(bayId);
      }
      return next;
    });
  }

  function clearBayFilter() {
    setSelectedBayIds(new Set());
  }

  // Load more handler
  async function loadMore() {
    if (loadingMore || allLoaded || !loadMoreCursor) return;
    setLoadingMore(true);

    try {
      const supabase = createClient();
      const chunkEnd = loadMoreCursor;
      const chunkStart = getDateDaysAgo(chunkEnd, 29);

      let query = supabase
        .from("bookings")
        .select(
          "id, date, start_time, end_time, total_price_cents, status, confirmation_code, notes, created_at, updated_at, customer_id, bay_id, is_guest, guest_name, guest_email, guest_phone, modified_from"
        )
        .eq("org_id", orgId)
        .gte("date", chunkStart)
        .lte("date", chunkEnd)
        .order("date", { ascending: false })
        .order("start_time", { ascending: false });

      // Apply same status filter as server
      if (tabContext === "completed") {
        query = query
          .eq("status", "confirmed")
          .lt("end_time", new Date().toISOString());
      } else {
        // canceled-past
        query = query
          .eq("status", "cancelled")
          .lt("start_time", new Date().toISOString());
      }

      const { data: moreBookings } = await query;

      if (!moreBookings || moreBookings.length === 0) {
        setAllLoaded(true);
      } else {
        // Enrich with modified_from_info (simplified — use bayMap from props)
        const enriched: Booking[] = moreBookings.map((b) => ({
          ...b,
          modified_from_info: null,
        }));

        // Fetch customer names for new bookings
        const newCustomerIds = [
          ...new Set(
            enriched
              .map((b) => b.customer_id)
              .filter(
                (id): id is string =>
                  id !== null && !(id in customerMap)
              )
          ),
        ];
        if (newCustomerIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", newCustomerIds);
          if (profiles) {
            for (const p of profiles) {
              customerMap[p.id] = {
                full_name: p.full_name,
                email: p.email,
              };
            }
          }
        }

        setExtraBookings((prev) => [...prev, ...enriched]);
        setLoadMoreCursor(getDateDaysAgo(chunkStart, 1));
      }
    } catch {
      // Silently fail — admin can retry
    } finally {
      setLoadingMore(false);
    }
  }

  // Fetch a booking independently by confirmation code
  async function fetchBookingByCode(
    code: string
  ): Promise<BookingDetailData | null> {
    const supabase = createClient();
    const { data: booking } = await supabase
      .from("bookings")
      .select(
        "id, date, start_time, end_time, total_price_cents, status, confirmation_code, notes, created_at, customer_id, bay_id, is_guest, guest_name, guest_email, guest_phone, modified_from"
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
      bayName = bay?.name ?? "Unknown";
    }

    let customerName = "Unknown";
    let customerEmail: string | null = null;
    if (booking.is_guest) {
      customerName = booking.guest_name || "Guest";
      customerEmail = booking.guest_email;
    } else if (booking.customer_id) {
      const cached = customerMap[booking.customer_id];
      if (cached) {
        customerName = cached.full_name || cached.email;
        customerEmail = cached.full_name ? cached.email : null;
      } else {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", booking.customer_id)
          .single();
        if (profile) {
          customerName = profile.full_name || profile.email;
          customerEmail = profile.full_name ? profile.email : null;
        }
      }
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

    return {
      id: booking.id,
      date: booking.date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      total_price_cents: booking.total_price_cents,
      status: booking.status,
      confirmation_code: booking.confirmation_code,
      notes: booking.notes,
      created_at: booking.created_at,
      bayName,
      canCancel: booking.status === "confirmed",
      canModify: booking.status === "confirmed",
      modifiedFrom,
      customerName,
      customerEmail,
      isGuest: booking.is_guest,
      guestPhone: booking.is_guest ? booking.guest_phone : null,
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
      const display = getCustomerDisplay(found, customerMap);
      setSelectedBooking({
        id: found.id,
        date: found.date,
        start_time: found.start_time,
        end_time: found.end_time,
        total_price_cents: found.total_price_cents,
        status: found.status,
        confirmation_code: found.confirmation_code,
        notes: found.notes,
        created_at: found.created_at,
        bayName: bayMap[found.bay_id] ?? "Unknown",
        canCancel: found.status === "confirmed",
        canModify: found.status === "confirmed",
        modifiedFrom: found.modified_from_info || null,
        customerName: display.name,
        customerEmail: display.email,
        isGuest: display.isGuest,
        guestPhone: found.is_guest ? found.guest_phone : null,
      });
      setModalOpen(true);
      return;
    }

    fetchBookingByCode(initialBookingCode).then((data) => {
      if (data) {
        setFilterNotice(
          "Heads up — this booking is not included in your current filtered results."
        );
        setSelectedBooking(data);
        setModalOpen(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBookingCode, autoOpenedCode]);

  function openBooking(booking: Booking) {
    const display = getCustomerDisplay(booking, customerMap);
    setSelectedBooking({
      id: booking.id,
      date: booking.date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      total_price_cents: booking.total_price_cents,
      status: booking.status,
      confirmation_code: booking.confirmation_code,
      notes: booking.notes,
      created_at: booking.created_at,
      bayName: bayMap[booking.bay_id] ?? "Unknown",
      canCancel: booking.status === "confirmed",
      canModify: booking.status === "confirmed",
      modifiedFrom: booking.modified_from_info || null,
      customerName: display.name,
      customerEmail: display.email,
      isGuest: display.isGuest,
      guestPhone: booking.is_guest ? booking.guest_phone : null,
    });
    setFilterNotice(null);
    setModalOpen(true);
    updateBookingUrl(booking.confirmation_code);
  }

  function handleOpenChange(open: boolean) {
    setModalOpen(open);
    if (!open) {
      setFilterNotice(null);
      updateBookingUrl(null);
    }
  }

  // Selected bay names for display above facility column
  const selectedBayNames = bays
    .filter((b) => selectedBayIds.has(b.id))
    .map((b) => b.name);

  return (
    <>
      {/* Desktop Table */}
      <div className="hidden md:block">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          {sorted.length === 0 && !hasLoadMore ? (
            <div className="px-5 py-16 text-center text-sm text-gray-500 dark:text-gray-400">
              No bookings found.
            </div>
          ) : sorted.length === 0 && hasLoadMore ? (
            <div className="px-5 py-16 text-center text-sm text-gray-500 dark:text-gray-400">
              No bookings in this date range.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-white/[0.05]">
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      Customer
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      Confirmation
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      <span className="inline-flex items-center">
                        Booked for
                        <SortArrows
                          field="booked_for"
                          activeField={sortField}
                          activeDirection={sortDirection}
                          onSort={handleSort}
                        />
                      </span>
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      <div>
                        {selectedBayNames.length > 0 && (
                          <div className="mb-0.5 text-[10px] font-normal text-blue-600 dark:text-blue-400">
                            {selectedBayNames.join(", ")}
                          </div>
                        )}
                        <span className="inline-flex items-center gap-1">
                          Facility
                          {bays.length > 1 && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  className={`rounded p-0.5 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 ${
                                    selectedBayIds.size > 0
                                      ? "text-blue-600 dark:text-blue-400"
                                      : "text-gray-400 dark:text-gray-500"
                                  }`}
                                >
                                  <Filter className="h-3 w-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent
                                align="start"
                                className="w-56 p-3"
                              >
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                    Filter by facility
                                  </span>
                                  {selectedBayIds.size > 0 && (
                                    <button
                                      type="button"
                                      onClick={clearBayFilter}
                                      className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                    >
                                      Clear
                                    </button>
                                  )}
                                </div>
                                <div className="space-y-1.5">
                                  {bays.map((bay) => (
                                    <label
                                      key={bay.id}
                                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selectedBayIds.has(bay.id)}
                                        onChange={() =>
                                          toggleBayFilter(bay.id)
                                        }
                                        className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
                                      />
                                      {bay.name}
                                    </label>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                        </span>
                      </div>
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      <span className="inline-flex items-center">
                        Created at
                        <SortArrows
                          field="created_at"
                          activeField={sortField}
                          activeDirection={sortDirection}
                          onSort={handleSort}
                        />
                      </span>
                    </th>
                    {showCanceledAt && (
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Canceled at
                      </th>
                    )}
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      Price
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {sorted.map((booking) => {
                    const display = getCustomerDisplay(
                      booking,
                      customerMap
                    );
                    const timeStr = `${formatTimeInZone(booking.start_time, timezone)} – ${formatTimeInZone(booking.end_time, timezone)}`;
                    const dateStr = new Date(
                      booking.date + "T12:00:00"
                    ).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    });

                    // Show active indicator on upcoming tab
                    const visualStatus = getVisualBookingStatus(
                      booking.status,
                      booking.start_time,
                      booking.end_time
                    );
                    const isActive =
                      tabContext === "upcoming" && visualStatus === "active";

                    return (
                      <tr
                        key={booking.id}
                        onClick={() => openBooking(booking)}
                        className="cursor-pointer transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]"
                      >
                        <td className="px-5 py-4">
                          <div>
                            <div className="flex items-center gap-2">
                              {isActive && (
                                <span className="relative flex h-2 w-2">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-600" />
                                </span>
                              )}
                              <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                                {display.name}
                              </p>
                              {display.isGuest && (
                                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                  Guest
                                </span>
                              )}
                            </div>
                            {display.email && (
                              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                {display.email}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="font-mono text-sm text-gray-600 dark:text-gray-300">
                            {booking.confirmation_code}
                          </span>
                          {booking.modified_from_info && (
                            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400">
                              <ArrowRight className="h-2.5 w-2.5" />
                              from{" "}
                              {formatTimeInZone(
                                booking.modified_from_info.startTime,
                                timezone
                              )}{" "}
                              –{" "}
                              {formatTimeInZone(
                                booking.modified_from_info.endTime,
                                timezone
                              )}
                              ,{" "}
                              {new Date(
                                booking.modified_from_info.date +
                                  "T12:00:00"
                              ).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                              , {booking.modified_from_info.bayName}
                            </p>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <div>
                            <p className="text-sm text-gray-800 dark:text-white/90">
                              {dateStr}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                              {timeStr}
                            </p>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-sm text-gray-800 dark:text-white/90">
                            {bayMap[booking.bay_id] ?? "Unknown"}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            {formatDateTimeInZone(
                              booking.created_at,
                              timezone
                            )}
                          </span>
                        </td>
                        {showCanceledAt && (
                          <td className="px-5 py-4">
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              {formatDateTimeInZone(
                                booking.updated_at,
                                timezone
                              )}
                            </span>
                          </td>
                        )}
                        <td className="px-5 py-4">
                          <span className="text-sm font-semibold text-gray-800 dark:text-white/90">
                            $
                            {(booking.total_price_cents / 100).toFixed(
                              2
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="space-y-3 md:hidden">
        {sorted.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-16 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
            No bookings found.
          </div>
        )}

        {/* Mobile sort controls */}
        {sorted.length > 0 && (
          <div className="flex items-center gap-3 px-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Sort by:
            </span>
            <button
              type="button"
              onClick={() =>
                handleSort(
                  "booked_for",
                  sortField === "booked_for" && sortDirection === "asc"
                    ? "desc"
                    : "asc"
                )
              }
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                sortField === "booked_for"
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
              }`}
            >
              Booked for
              {sortField === "booked_for" &&
                (sortDirection === "asc" ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                ))}
            </button>
            <button
              type="button"
              onClick={() =>
                handleSort(
                  "created_at",
                  sortField === "created_at" && sortDirection === "asc"
                    ? "desc"
                    : "asc"
                )
              }
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                sortField === "created_at"
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
              }`}
            >
              Created at
              {sortField === "created_at" &&
                (sortDirection === "asc" ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                ))}
            </button>
            {bays.length > 1 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      selectedBayIds.size > 0
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    }`}
                  >
                    <Filter className="h-3 w-3" />
                    Facility
                    {selectedBayIds.size > 0 &&
                      ` (${selectedBayIds.size})`}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      Filter by facility
                    </span>
                    {selectedBayIds.size > 0 && (
                      <button
                        type="button"
                        onClick={clearBayFilter}
                        className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {bays.map((bay) => (
                      <label
                        key={bay.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        <input
                          type="checkbox"
                          checked={selectedBayIds.has(bay.id)}
                          onChange={() => toggleBayFilter(bay.id)}
                          className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
                        />
                        {bay.name}
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        )}

        {sorted.map((booking) => {
          const display = getCustomerDisplay(booking, customerMap);
          const timeStr = `${formatTimeInZone(booking.start_time, timezone)} – ${formatTimeInZone(booking.end_time, timezone)}`;
          const dateStr = new Date(
            booking.date + "T12:00:00"
          ).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          });

          const visualStatus = getVisualBookingStatus(
            booking.status,
            booking.start_time,
            booking.end_time
          );
          const isActive =
            tabContext === "upcoming" && visualStatus === "active";

          return (
            <button
              key={booking.id}
              type="button"
              onClick={() => openBooking(booking)}
              className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:bg-white/[0.05]"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {isActive && (
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-600" />
                      </span>
                    )}
                    <p className="truncate text-sm font-semibold text-gray-800 dark:text-white/90">
                      {display.name}
                    </p>
                    {display.isGuest && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        Guest
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {dateStr} · {timeStr} ·{" "}
                    {bayMap[booking.bay_id] ?? "Unknown"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                    Created{" "}
                    {formatDateTimeInZone(booking.created_at, timezone)}
                    {showCanceledAt && (
                      <>
                        {" "}
                        · Canceled{" "}
                        {formatDateTimeInZone(
                          booking.updated_at,
                          timezone
                        )}
                      </>
                    )}
                  </p>
                </div>
                <span className="ml-3 text-sm font-semibold text-gray-800 dark:text-white/90">
                  ${(booking.total_price_cents / 100).toFixed(2)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Load More button (completed + canceled-past only) */}
      {hasLoadMore && (
        <div className="mt-4 flex justify-center">
          {allLoaded ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">
              All bookings loaded
            </p>
          ) : (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {loadingMore ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading...
                </>
              ) : (
                "Load more"
              )}
            </button>
          )}
        </div>
      )}

      <BookingDetailsModal
        booking={selectedBooking}
        variant="admin"
        timezone={timezone}
        open={modalOpen}
        onOpenChange={handleOpenChange}
        cancelAction={cancelAction}
        notice={filterNotice}
        cancellationWindowHours={cancellationWindowHours}
        paymentMode={paymentMode}
      />
    </>
  );
}
