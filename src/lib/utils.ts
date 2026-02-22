import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
