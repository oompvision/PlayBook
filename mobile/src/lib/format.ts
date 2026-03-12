/**
 * Formatting utilities — mirrors the web app's utils.ts.
 */

/** Format cents as dollars: 5000 → "$50", 5060 → "$50.60". Omits decimals for whole dollar amounts. */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  if (Number.isInteger(dollars)) {
    return `$${dollars}`;
  }
  return `$${dollars.toFixed(2)}`;
}

/** Format a timestamptz string as a localized time in the given timezone. */
export function formatTimeInZone(
  timestamp: string,
  timezone: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
    ...options,
  }).format(date);
}

/** Get today's date string (YYYY-MM-DD) in a given timezone. */
export function getTodayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Format a date string as a human-readable date. */
export function formatDate(dateStr: string, timezone?: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(date);
}

/** Format a date string as a full date. */
export function formatDateLong(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}
