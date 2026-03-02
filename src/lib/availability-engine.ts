/**
 * Dynamic Scheduling — Availability Calculation Engine
 *
 * Computes available booking time windows based on:
 * - Dynamic schedule rules (operating hours, durations, buffers, granularity)
 * - Existing bookings on the facility
 * - Block-outs set by admins
 *
 * All times are handled in the facility's IANA timezone.
 */

export type DynamicScheduleRule = {
  id: string;
  bay_id: string;
  org_id: string;
  day_of_week: number;
  open_time: string; // "HH:MM" or "HH:MM:SS"
  close_time: string;
  available_durations: number[];
  buffer_minutes: number;
  start_time_granularity: number; // 15, 30, or 60
};

export type ExistingBooking = {
  start_time: string; // timestamptz ISO string
  end_time: string;
};

export type BlockOut = {
  start_time: string; // timestamptz ISO string
  end_time: string;
};

export type AvailableTimeSlot = {
  start_time: string; // ISO timestamp in facility timezone
  end_time: string;
  price_cents: number;
  bay_id: string;
  bay_name: string;
};

export type BayInfo = {
  id: string;
  name: string;
  hourly_rate_cents: number;
};

// ─── Helpers ────────────────────────────────────────────────

/**
 * Parse a time string "HH:MM" or "HH:MM:SS" into minutes since midnight.
 */
function timeToMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

/**
 * Convert an ISO timestamp to minutes-since-midnight in the given timezone.
 */
function timestampToMinutes(timestamp: string, timezone: string): number {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);

  const hour = parseInt(
    parts.find((p) => p.type === "hour")?.value || "0",
    10
  );
  const minute = parseInt(
    parts.find((p) => p.type === "minute")?.value || "0",
    10
  );
  return (hour === 24 ? 0 : hour) * 60 + minute;
}

/**
 * Build a timezone-aware ISO timestamp from a date + minutes-since-midnight.
 * Uses the same approach as toTimestamp in utils.ts.
 */
function minutesToTimestamp(
  dateStr: string,
  minutes: number,
  timezone: string
): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const timeStr = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;

  // Use Intl to get the correct UTC offset for this date+time in the timezone
  const naive = new Date(`${dateStr}T${timeStr}`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const getParts = (tz: string) => {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = f.formatToParts(naive);
    const get = (type: string) =>
      parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour") === 24 ? 0 : get("hour"),
      minute: get("minute"),
    };
  };

  const utcParts = getParts("UTC");
  const tzParts = getParts(timezone);

  const utcDate = new Date(
    Date.UTC(
      utcParts.year,
      utcParts.month - 1,
      utcParts.day,
      utcParts.hour,
      utcParts.minute
    )
  );
  const tzAsUtc = new Date(
    Date.UTC(
      tzParts.year,
      tzParts.month - 1,
      tzParts.day,
      tzParts.hour,
      tzParts.minute
    )
  );

  const offsetMs = tzAsUtc.getTime() - utcDate.getTime();
  const offsetMinutes = offsetMs / 60000;
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absMinutes / 60)).padStart(2, "0");
  const offsetMins = String(absMinutes % 60).padStart(2, "0");

  return `${dateStr}T${timeStr}${sign}${offsetHours}:${offsetMins}`;
}

// ─── Core Engine ────────────────────────────────────────────

/**
 * Get available time slots for a single bay on a given date and duration.
 */
export function getAvailableTimesForBay(params: {
  bay: BayInfo;
  rule: DynamicScheduleRule;
  date: string; // YYYY-MM-DD
  duration: number; // requested duration in minutes
  timezone: string;
  existingBookings: ExistingBooking[];
  blockOuts: BlockOut[];
  minBookingLeadMinutes?: number;
}): AvailableTimeSlot[] {
  const {
    bay,
    rule,
    date,
    duration,
    timezone,
    existingBookings,
    blockOuts,
    minBookingLeadMinutes = 0,
  } = params;

  const openMinutes = timeToMinutes(rule.open_time);
  const closeMinutes = timeToMinutes(rule.close_time);
  const granularity = rule.start_time_granularity;
  const buffer = rule.buffer_minutes;

  // Validate duration fits within operating hours
  if (duration > closeMinutes - openMinutes) {
    return [];
  }

  // Convert existing bookings to minute ranges
  const bookingRanges = existingBookings.map((b) => ({
    start: timestampToMinutes(b.start_time, timezone),
    end: timestampToMinutes(b.end_time, timezone),
  }));

  // Convert block-outs to minute ranges (no buffer applied)
  const blockOutRanges = blockOuts.map((b) => ({
    start: timestampToMinutes(b.start_time, timezone),
    end: timestampToMinutes(b.end_time, timezone),
  }));

  // Calculate the earliest bookable start time based on lead time
  let earliestStartMinutes = openMinutes;
  if (minBookingLeadMinutes > 0) {
    const nowMinutes = timestampToMinutes(new Date().toISOString(), timezone);
    // Check if today
    const todayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
    }).format(new Date()); // YYYY-MM-DD format
    if (date === todayStr) {
      earliestStartMinutes = Math.max(
        openMinutes,
        nowMinutes + minBookingLeadMinutes
      );
    }
  }

  const results: AvailableTimeSlot[] = [];

  // Generate candidate start times: from open_time, step by granularity
  for (
    let startMin = openMinutes;
    startMin + duration <= closeMinutes;
    startMin += granularity
  ) {
    // Skip if before earliest bookable time
    if (startMin < earliestStartMinutes) continue;

    const endMin = startMin + duration;

    // Check overlap with existing bookings (apply buffer on both sides)
    const overlapsBooking = bookingRanges.some((booking) => {
      const bookingStartWithBuffer = booking.start - buffer;
      const bookingEndWithBuffer = booking.end + buffer;
      return startMin < bookingEndWithBuffer && endMin > bookingStartWithBuffer;
    });
    if (overlapsBooking) continue;

    // Check overlap with block-outs (no buffer)
    const overlapsBlockOut = blockOutRanges.some((bo) => {
      return startMin < bo.end && endMin > bo.start;
    });
    if (overlapsBlockOut) continue;

    // Calculate price: bay hourly rate * (duration / 60)
    const priceCents = Math.round(bay.hourly_rate_cents * (duration / 60));

    results.push({
      start_time: minutesToTimestamp(date, startMin, timezone),
      end_time: minutesToTimestamp(date, endMin, timezone),
      price_cents: priceCents,
      bay_id: bay.id,
      bay_name: bay.name,
    });
  }

  return results;
}

/**
 * Get pooled availability across all bays in a facility group.
 * Returns deduplicated times — a time is available if ANY bay in the group has it.
 */
export function getPooledAvailability(params: {
  bays: BayInfo[];
  rulesMap: Map<string, DynamicScheduleRule>; // bay_id → rule for the given day
  date: string;
  duration: number;
  timezone: string;
  bookingsMap: Map<string, ExistingBooking[]>; // bay_id → bookings
  blockOutsMap: Map<string, BlockOut[]>; // bay_id → block-outs
  minBookingLeadMinutes?: number;
}): AvailableTimeSlot[] {
  const {
    bays,
    rulesMap,
    date,
    duration,
    timezone,
    bookingsMap,
    blockOutsMap,
    minBookingLeadMinutes,
  } = params;

  // Collect all available slots per bay
  const allSlots: AvailableTimeSlot[] = [];

  for (const bay of bays) {
    const rule = rulesMap.get(bay.id);
    if (!rule) continue; // Bay not open this day

    const slots = getAvailableTimesForBay({
      bay,
      rule,
      date,
      duration,
      timezone,
      existingBookings: bookingsMap.get(bay.id) || [],
      blockOuts: blockOutsMap.get(bay.id) || [],
      minBookingLeadMinutes,
    });
    allSlots.push(...slots);
  }

  // Deduplicate by start_time — keep the first occurrence (from the bay with most bookings
  // due to consolidation preference, but we handle that at booking time, not display time)
  const seen = new Map<string, AvailableTimeSlot>();
  for (const slot of allSlots) {
    if (!seen.has(slot.start_time)) {
      seen.set(slot.start_time, slot);
    }
  }

  // Sort by start time
  return Array.from(seen.values()).sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );
}

/**
 * Consolidation: pick which bay to assign from an interchangeable group.
 * Strategy: prefer the bay with the most existing bookings (pack bookings
 * onto fewer facilities to keep others open for longer blocks).
 */
export function pickBayForBooking(params: {
  bays: BayInfo[];
  rulesMap: Map<string, DynamicScheduleRule>;
  startTime: string;
  endTime: string;
  date: string;
  timezone: string;
  bookingsMap: Map<string, ExistingBooking[]>;
  blockOutsMap: Map<string, BlockOut[]>;
}): string | null {
  const {
    bays,
    rulesMap,
    startTime,
    endTime,
    date,
    timezone,
    bookingsMap,
    blockOutsMap,
  } = params;

  const startMin = timestampToMinutes(startTime, timezone);
  const endMin = timestampToMinutes(endTime, timezone);

  // Sort bays by number of existing bookings descending (most-booked first)
  const baysByLoad = [...bays].sort((a, b) => {
    const aBookings = bookingsMap.get(a.id)?.length || 0;
    const bBookings = bookingsMap.get(b.id)?.length || 0;
    return bBookings - aBookings;
  });

  for (const bay of baysByLoad) {
    const rule = rulesMap.get(bay.id);
    if (!rule) continue;

    const buffer = rule.buffer_minutes;
    const bookings = bookingsMap.get(bay.id) || [];
    const blockouts = blockOutsMap.get(bay.id) || [];

    // Check overlap with existing bookings + buffer
    const overlapsBooking = bookings.some((b) => {
      const bStart = timestampToMinutes(b.start_time, timezone);
      const bEnd = timestampToMinutes(b.end_time, timezone);
      return startMin < bEnd + buffer && endMin > bStart - buffer;
    });
    if (overlapsBooking) continue;

    // Check overlap with block-outs (no buffer)
    const overlapsBlockOut = blockouts.some((bo) => {
      const boStart = timestampToMinutes(bo.start_time, timezone);
      const boEnd = timestampToMinutes(bo.end_time, timezone);
      return startMin < boEnd && endMin > boStart;
    });
    if (overlapsBlockOut) continue;

    return bay.id;
  }

  return null; // All bays fully booked for this time
}
