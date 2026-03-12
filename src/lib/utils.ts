import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format cents as a dollar string: 5000 → "$50", 5060 → "$50.60".
 * Omits decimals when the amount is a whole dollar.
 */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  if (Number.isInteger(dollars)) {
    return `$${dollars}`;
  }
  return `$${dollars.toFixed(2)}`;
}

/**
 * Build a timezone-aware ISO timestamp from a date string and time string.
 * e.g. toTimestamp("2025-02-20", "09:00:00", "America/New_York")
 * → "2025-02-20T09:00:00-05:00"
 *
 * Uses Intl.DateTimeFormat to resolve the correct UTC offset for the
 * given date+time in the given IANA timezone (handles DST correctly).
 */
export function toTimestamp(
  date: string,
  time: string,
  timezone: string
): string {
  // Parse as if local, then figure out the UTC offset for that moment in the target timezone
  const naive = new Date(`${date}T${time}`);
  const utcMs = naive.getTime();

  // Get the offset by comparing UTC formatting vs timezone formatting
  const utcParts = getDateParts(naive, "UTC");
  const tzParts = getDateParts(naive, timezone);

  // Reconstruct dates from parts to compute offset
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

/**
 * Get today's date string (YYYY-MM-DD) in the given IANA timezone.
 * Avoids the common bug of using new Date().toISOString() which returns UTC.
 */
export function getTodayInTimezone(timezone: string): string {
  const parts = getDateParts(new Date(), timezone);
  const y = String(parts.year);
  const m = String(parts.month).padStart(2, "0");
  const d = String(parts.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

/**
 * Format a timestamptz string for display in a specific IANA timezone.
 * Returns e.g. "9:00 AM"
 */
export function formatTimeInZone(
  timestamp: string,
  timezone: string
): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Compute a visual booking status from the DB status + date/time.
 * Returns "active" | "confirmed" | "completed" | "cancelled".
 * - "active": confirmed + currently within start→end time
 * - "confirmed": confirmed + in the future
 * - "completed": confirmed + end time has passed
 * - "cancelled": DB status is cancelled
 */
export type VisualBookingStatus = "active" | "confirmed" | "completed" | "cancelled";

export function getVisualBookingStatus(
  dbStatus: string,
  startTime: string,
  endTime: string,
): VisualBookingStatus {
  if (dbStatus === "cancelled") return "cancelled";

  const now = Date.now();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  if (now >= start && now < end) return "active";
  if (now >= end) return "completed";
  return "confirmed";
}
