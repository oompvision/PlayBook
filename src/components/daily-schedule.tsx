"use client";

import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight, Clock, Eye, EyeOff, X } from "lucide-react";

export interface DailyBooking {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  total_price_cents: number;
  status: string;
  confirmation_code: string;
  notes: string | null;
  customer_id: string;
  bay_id: string;
  is_guest?: boolean;
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
}

export interface DailyScheduleProps {
  bookings: DailyBooking[];
  bays: { id: string; name: string }[];
  customerMap: Record<string, { full_name: string | null; email: string }>;
  timezone: string;
  initialDate: string;
  cancelAction: (formData: FormData) => Promise<void>;
}

function formatTime(timestamp: string, timezone: string): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

function getHourInTimezone(timestamp: string, timezone: string): number {
  const d = new Date(timestamp);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(d);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  return hour === 24 ? 0 : hour + minute / 60;
}

function getNowInTimezone(timezone: string): { dateStr: string; hour: number } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  return {
    dateStr: `${year}-${month}-${day}`,
    hour: (hour === 24 ? 0 : hour) + minute / 60,
  };
}

function formatDateForDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const ny = date.getFullYear();
  const nm = String(date.getMonth() + 1).padStart(2, "0");
  const nd = String(date.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

const HOUR_HEIGHT = 80; // px per hour

export function DailySchedule({
  bookings: allBookings,
  bays,
  customerMap,
  timezone,
  initialDate,
  cancelAction,
}: DailyScheduleProps) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [showCancelled, setShowCancelled] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCancelledForId, setShowCancelledForId] = useState<string | null>(null);
  const [now, setNow] = useState(() => getNowInTimezone(timezone));

  // Update current time every 2 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(getNowInTimezone(timezone));
    }, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [timezone]);

  // Filter bookings for selected date
  const dayBookings = useMemo(() => {
    return allBookings.filter((b) => {
      if (b.date !== selectedDate) return false;
      if (!showCancelled && b.status === "cancelled") return false;
      return true;
    });
  }, [allBookings, selectedDate, showCancelled]);

  // Compute dynamic time range from scheduled slots
  const { startHour, endHour } = useMemo(() => {
    if (dayBookings.length === 0) return { startHour: 8, endHour: 18 };
    let min = 24;
    let max = 0;
    for (const b of dayBookings) {
      const s = getHourInTimezone(b.start_time, timezone);
      const e = getHourInTimezone(b.end_time, timezone);
      if (s < min) min = s;
      if (e > max) max = e;
    }
    return { startHour: Math.floor(min), endHour: Math.ceil(max) };
  }, [dayBookings, timezone]);

  const totalHours = endHour - startHour;
  const gridHeight = totalHours * HOUR_HEIGHT;
  const hourLabels = Array.from({ length: totalHours + 1 }, (_, i) => startHour + i);

  // Current time line position
  const isToday = now.dateStr === selectedDate;
  const nowInRange = isToday && now.hour >= startHour && now.hour <= endHour;
  const nowOffset = nowInRange ? ((now.hour - startHour) / totalHours) * 100 : -1;

  return (
    <div>
      {/* Header: date nav + controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-l-lg text-gray-500 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
            onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="h-9 w-px bg-gray-200 dark:bg-gray-700" />
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-r-lg text-gray-500 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
            onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
        />

        <button
          type="button"
          className="h-9 rounded-lg px-3 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          onClick={() => setSelectedDate(getNowInTimezone(timezone).dateStr)}
        >
          Today
        </button>

        <span className="text-base font-semibold text-gray-800 dark:text-white/90">
          {formatDateForDisplay(selectedDate)}
        </span>

        <div className="ml-auto">
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            onClick={() => setShowCancelled(!showCancelled)}
          >
            {showCancelled ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {showCancelled ? "Hide" : "Show"} cancelled
          </button>
        </div>
      </div>

      {dayBookings.length === 0 ? (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white px-5 py-16 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
          No bookings for this day.
        </div>
      ) : (
        /* Timeline grid */
        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div
            className="grid"
            style={{
              gridTemplateColumns: `60px repeat(${bays.length}, minmax(160px, 1fr))`,
            }}
          >
            {/* Column headers */}
            <div className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50/80 p-2 text-xs font-medium text-gray-500 backdrop-blur dark:border-white/[0.05] dark:bg-gray-900/80 dark:text-gray-400">
              <Clock className="mx-auto h-4 w-4" />
            </div>
            {bays.map((bay) => (
              <div
                key={bay.id}
                className="sticky top-0 z-10 border-b border-l border-gray-100 bg-gray-50/80 p-2 text-center text-sm font-semibold text-gray-800 backdrop-blur dark:border-white/[0.05] dark:bg-gray-900/80 dark:text-white/90"
              >
                {bay.name}
              </div>
            ))}

            {/* Time column + bay columns */}
            <div className="relative border-r border-gray-100 dark:border-white/[0.05]" style={{ height: gridHeight }}>
              {hourLabels.map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 flex items-start justify-end pr-2 text-xs text-gray-500 dark:text-gray-400"
                  style={{ top: (h - startHour) * HOUR_HEIGHT }}
                >
                  {h === 0
                    ? "12 AM"
                    : h < 12
                      ? `${h} AM`
                      : h === 12
                        ? "12 PM"
                        : `${h - 12} PM`}
                </div>
              ))}
            </div>

            {bays.map((bay) => {
              const bayBookings = dayBookings.filter(
                (b) => b.bay_id === bay.id
              );

              // Separate active vs cancelled, group overlapping cancelled with their active counterpart
              const activeBookings = bayBookings.filter(
                (b) => b.status !== "cancelled"
              );
              const cancelledBookings = showCancelled
                ? bayBookings.filter((b) => b.status === "cancelled")
                : [];

              const cancelledByActiveId = new Map<string, DailyBooking[]>();
              const orphanCancelled: DailyBooking[] = [];

              for (const cb of cancelledBookings) {
                const cbStart = getHourInTimezone(cb.start_time, timezone);
                const cbEnd = getHourInTimezone(cb.end_time, timezone);
                let matched = false;
                for (const ab of activeBookings) {
                  const abStart = getHourInTimezone(ab.start_time, timezone);
                  const abEnd = getHourInTimezone(ab.end_time, timezone);
                  // Check time overlap
                  if (cbStart < abEnd && cbEnd > abStart) {
                    if (!cancelledByActiveId.has(ab.id)) {
                      cancelledByActiveId.set(ab.id, []);
                    }
                    cancelledByActiveId.get(ab.id)!.push(cb);
                    matched = true;
                    break;
                  }
                }
                if (!matched) {
                  orphanCancelled.push(cb);
                }
              }

              // Group overlapping orphan cancelled into clusters
              const orphanClusters: DailyBooking[][] = [];
              for (const oc of orphanCancelled) {
                const ocStart = getHourInTimezone(oc.start_time, timezone);
                const ocEnd = getHourInTimezone(oc.end_time, timezone);
                let added = false;
                for (const cluster of orphanClusters) {
                  const overlaps = cluster.some((cb) => {
                    const cbStart = getHourInTimezone(cb.start_time, timezone);
                    const cbEnd = getHourInTimezone(cb.end_time, timezone);
                    return ocStart < cbEnd && ocEnd > cbStart;
                  });
                  if (overlaps) {
                    cluster.push(oc);
                    added = true;
                    break;
                  }
                }
                if (!added) {
                  orphanClusters.push([oc]);
                }
              }

              return (
                <div
                  key={bay.id}
                  className="relative border-l border-gray-100 dark:border-white/[0.05]"
                  style={{ height: gridHeight }}
                >
                  {/* Hour gridlines */}
                  {hourLabels.map((h) => (
                    <div
                      key={h}
                      className="absolute left-0 right-0 border-t border-dashed border-gray-100 dark:border-white/[0.05]"
                      style={{ top: (h - startHour) * HOUR_HEIGHT }}
                    />
                  ))}

                  {/* Active booking cards */}
                  {activeBookings.map((booking) => {
                    const bStart = getHourInTimezone(booking.start_time, timezone);
                    const bEnd = getHourInTimezone(booking.end_time, timezone);
                    const top = ((bStart - startHour) / totalHours) * 100;
                    const height = ((bEnd - bStart) / totalHours) * 100;
                    const isExpanded = expandedId === booking.id;
                    const customer = booking.customer_id ? customerMap[booking.customer_id] : null;
                    const name = booking.is_guest
                      ? (booking.guest_name || "Guest")
                      : (customer?.full_name || customer?.email || "Unknown");
                    const associatedCancelled = cancelledByActiveId.get(booking.id);
                    const hasCancelledExpanded = showCancelledForId === booking.id;
                    const needsAutoHeight = isExpanded || hasCancelledExpanded;

                    return (
                      <div
                        key={booking.id}
                        className={`absolute left-1 right-1 cursor-pointer overflow-hidden rounded-lg border px-2 py-1.5 text-xs shadow-sm transition-all ${
                          isExpanded
                            ? "z-20 border-blue-300 bg-blue-50 ring-2 ring-blue-500/30 dark:border-blue-700 dark:bg-blue-950/40 dark:ring-blue-500/20"
                            : hasCancelledExpanded
                              ? "z-30 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"
                              : "z-10 border-blue-200 bg-blue-50 hover:bg-blue-100/80 dark:border-blue-800 dark:bg-blue-950/30 dark:hover:bg-blue-950/50"
                        }`}
                        style={{
                          top: `${top}%`,
                          height: needsAutoHeight ? "auto" : `${height}%`,
                          minHeight: needsAutoHeight ? `${height}%` : undefined,
                        }}
                        onClick={() =>
                          setExpandedId(isExpanded ? null : booking.id)
                        }
                      >
                        <p className="truncate font-semibold text-gray-800 dark:text-white/90">{name}</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400">
                          {formatTime(booking.start_time, timezone)} –{" "}
                          {formatTime(booking.end_time, timezone)}
                        </p>
                        <p className="font-mono text-[10px] text-gray-500 dark:text-gray-400">
                          {booking.confirmation_code}
                        </p>
                        <p className="text-[10px] font-semibold text-gray-700 dark:text-gray-300">
                          ${(booking.total_price_cents / 100).toFixed(2)}
                        </p>

                        {/* Cancelled bookings indicator */}
                        {associatedCancelled && associatedCancelled.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowCancelledForId(
                                hasCancelledExpanded ? null : booking.id
                              );
                            }}
                            className="mt-0.5 block text-[10px] font-medium text-red-600 no-underline hover:text-red-700 hover:underline dark:text-red-400 dark:hover:text-red-300"
                          >
                            {associatedCancelled.length} Cancelled{" "}
                            {hasCancelledExpanded ? "▲" : "▼"}
                          </button>
                        )}

                        {/* Inline cancelled bookings list */}
                        {hasCancelledExpanded && associatedCancelled && (
                          <div
                            className="mt-1.5 overflow-hidden rounded-lg border border-red-200 bg-white text-[10px] shadow-md dark:border-red-900 dark:bg-gray-900"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="border-b border-red-200 bg-red-50 px-2.5 py-1 font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
                              Cancelled Bookings
                            </div>
                            <div className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                              {associatedCancelled.map((cb) => {
                                const cbCustomer = cb.customer_id ? customerMap[cb.customer_id] : null;
                                const cbName = cb.is_guest
                                  ? (cb.guest_name || "Guest")
                                  : (cbCustomer?.full_name ||
                                  cbCustomer?.email ||
                                  "Unknown");
                                return (
                                  <div
                                    key={cb.id}
                                    className="px-2.5 py-1.5"
                                  >
                                    <p className="truncate font-medium text-gray-800 dark:text-white/90">
                                      {cbName}
                                    </p>
                                    <div className="mt-0.5 flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                      <span className="font-mono">
                                        {cb.confirmation_code}
                                      </span>
                                      <span>
                                        ${(cb.total_price_cents / 100).toFixed(2)}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {isExpanded && (
                          <div
                            className="mt-2 space-y-2 border-t border-blue-200 pt-2 dark:border-blue-800"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="space-y-1.5">
                              <div className="flex justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Customer</span>
                                <span className="flex items-center gap-1.5 text-gray-800 dark:text-white/90">
                                  {booking.is_guest ? (booking.guest_name || "Guest") : (customer?.full_name || "N/A")}
                                  {booking.is_guest && (
                                    <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                      Guest
                                    </span>
                                  )}
                                </span>
                              </div>
                              {(booking.is_guest ? booking.guest_email : customer?.email) && (
                                <div className="flex justify-between">
                                  <span className="text-gray-500 dark:text-gray-400">Email</span>
                                  <span className="text-gray-800 dark:text-white/90">
                                    {booking.is_guest ? booking.guest_email : customer?.email}
                                  </span>
                                </div>
                              )}
                              {booking.is_guest && booking.guest_phone && (
                                <div className="flex justify-between">
                                  <span className="text-gray-500 dark:text-gray-400">Phone</span>
                                  <span className="text-gray-800 dark:text-white/90">
                                    {booking.guest_phone}
                                  </span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Facility</span>
                                <span className="text-gray-800 dark:text-white/90">{bay.name}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Time</span>
                                <span className="text-gray-800 dark:text-white/90">
                                  {formatTime(booking.start_time, timezone)} –{" "}
                                  {formatTime(booking.end_time, timezone)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Code</span>
                                <span className="font-mono text-gray-800 dark:text-white/90">
                                  {booking.confirmation_code}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Price</span>
                                <span className="font-semibold text-gray-800 dark:text-white/90">
                                  ${(booking.total_price_cents / 100).toFixed(2)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Status</span>
                                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                  {booking.status}
                                </span>
                              </div>
                              {booking.notes && (
                                <div className="flex justify-between">
                                  <span className="text-gray-500 dark:text-gray-400">Notes</span>
                                  <span className="text-right italic text-gray-800 dark:text-white/90">
                                    {booking.notes}
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                              <form action={cancelAction}>
                                <input
                                  type="hidden"
                                  name="booking_id"
                                  value={booking.id}
                                />
                                <button
                                  type="submit"
                                  className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-[10px] font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 dark:border-red-800 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30"
                                >
                                  <X className="h-3 w-3" />
                                  Cancel Booking
                                </button>
                              </form>
                              <button
                                type="button"
                                className="rounded-md px-2 py-1 text-[10px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                                onClick={() => setExpandedId(null)}
                              >
                                Close
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Orphan cancelled booking clusters */}
                  {orphanClusters.map((cluster, idx) => {
                    const clusterKey = `orphan-${bay.id}-${idx}`;
                    const earliestStart = Math.min(
                      ...cluster.map((c) =>
                        getHourInTimezone(c.start_time, timezone)
                      )
                    );
                    const top =
                      ((earliestStart - startHour) / totalHours) * 100;
                    const isOpen = showCancelledForId === clusterKey;

                    return (
                      <div
                        key={clusterKey}
                        className={`absolute left-1 right-1 ${isOpen ? "z-30" : "z-[5]"}`}
                        style={{ top: `${top}%` }}
                      >
                        <button
                          className="w-full cursor-pointer rounded-lg border border-red-200 bg-red-50 py-0.5 text-center text-[10px] font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
                          onClick={() =>
                            setShowCancelledForId(
                              isOpen ? null : clusterKey
                            )
                          }
                        >
                          {cluster.length} Cancelled{" "}
                          {isOpen ? "▲" : "▼"}
                        </button>
                        {isOpen && (
                          <div className="mt-1 overflow-hidden rounded-lg border border-red-200 bg-white text-[10px] shadow-xl dark:border-red-900 dark:bg-gray-900">
                            <div className="border-b border-red-200 bg-red-50 px-2.5 py-1 font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
                              Cancelled Bookings
                            </div>
                            <div className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                              {cluster.map((cb) => {
                                const cbCustomer = cb.customer_id
                                  ? customerMap[cb.customer_id]
                                  : null;
                                const cbName = cb.is_guest
                                  ? (cb.guest_name || "Guest")
                                  : (cbCustomer?.full_name ||
                                  cbCustomer?.email ||
                                  "Unknown");
                                return (
                                  <div
                                    key={cb.id}
                                    className="px-2.5 py-1.5"
                                  >
                                    <p className="truncate font-medium text-gray-800 dark:text-white/90">
                                      {cbName}
                                    </p>
                                    <div className="mt-0.5 flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                      <span>
                                        {formatTime(cb.start_time, timezone)}{" "}
                                        –{" "}
                                        {formatTime(cb.end_time, timezone)}
                                      </span>
                                      <span className="font-mono">
                                        {cb.confirmation_code}
                                      </span>
                                      <span>
                                        $
                                        {(
                                          cb.total_price_cents / 100
                                        ).toFixed(2)}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Current time line */}
                  {nowInRange && (
                    <div
                      className="absolute left-0 right-0 z-30 border-t-2 border-red-500"
                      style={{ top: `${nowOffset}%` }}
                    >
                      <div className="absolute -top-1.5 -left-1 h-3 w-3 rounded-full bg-red-500" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
