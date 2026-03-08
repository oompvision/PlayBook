/**
 * Dynamic Scheduling — Mobile Availability Engine
 *
 * Ported from the web app's availability-engine.ts.
 * Computes available booking time windows from schedule rules,
 * existing bookings, and block-outs. Supports pooled availability
 * across facility groups and bay consolidation at booking time.
 */

import { supabase } from './supabase';
import type { Bay, DynamicScheduleRule, AvailableTimeSlot } from '../types';

type ExistingBooking = { start_time: string; end_time: string };
type BlockOut = { start_time: string; end_time: string };
type BayInfo = { id: string; name: string; hourly_rate_cents: number };
type RateTier = { start_time: string; end_time: string; hourly_rate_cents: number };

// ─── Helpers ────────────────────────────────────────────────

function timeToMinutes(time: string): number {
  const parts = time.split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

function timestampToMinutes(timestamp: string, timezone: string): number {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);

  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  return (hour === 24 ? 0 : hour) * 60 + minute;
}

function minutesToTimestamp(dateStr: string, minutes: number, timezone: string): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;

  const naive = new Date(`${dateStr}T${timeStr}`);

  const getParts = (tz: string) => {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const ps = f.formatToParts(naive);
    const get = (type: string) =>
      parseInt(ps.find((p) => p.type === type)?.value || '0', 10);
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour') === 24 ? 0 : get('hour'),
      minute: get('minute'),
    };
  };

  const utcParts = getParts('UTC');
  const tzParts = getParts(timezone);

  const utcDate = new Date(
    Date.UTC(utcParts.year, utcParts.month - 1, utcParts.day, utcParts.hour, utcParts.minute)
  );
  const tzAsUtc = new Date(
    Date.UTC(tzParts.year, tzParts.month - 1, tzParts.day, tzParts.hour, tzParts.minute)
  );

  const offsetMs = tzAsUtc.getTime() - utcDate.getTime();
  const offsetMinutes = offsetMs / 60000;
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absMinutes / 60)).padStart(2, '0');
  const offsetMins = String(absMinutes % 60).padStart(2, '0');

  return `${dateStr}T${timeStr}${sign}${offsetHours}:${offsetMins}`;
}

// ─── Pricing ────────────────────────────────────────────────

function resolveHourlyRate(
  startMinutes: number,
  bay: BayInfo,
  rule: DynamicScheduleRule
): number {
  if (rule.rate_tiers && rule.rate_tiers.length > 0) {
    for (const tier of rule.rate_tiers as RateTier[]) {
      const tStart = timeToMinutes(tier.start_time);
      const tEnd = timeToMinutes(tier.end_time);
      if (startMinutes >= tStart && startMinutes < tEnd) {
        return tier.hourly_rate_cents;
      }
    }
  }
  return bay.hourly_rate_cents;
}

// ─── Core Engine ────────────────────────────────────────────

function getAvailableTimesForBay(params: {
  bay: BayInfo;
  rule: DynamicScheduleRule;
  date: string;
  duration: number;
  timezone: string;
  existingBookings: ExistingBooking[];
  blockOuts: BlockOut[];
  minBookingLeadMinutes: number;
}): AvailableTimeSlot[] {
  const { bay, rule, date, duration, timezone, existingBookings, blockOuts, minBookingLeadMinutes } =
    params;

  const openMinutes = timeToMinutes(rule.open_time);
  const closeMinutes = timeToMinutes(rule.close_time);
  const granularity = rule.start_time_granularity;
  const buffer = rule.buffer_minutes;

  if (duration > closeMinutes - openMinutes) return [];

  const bookingRanges = existingBookings.map((b) => ({
    start: timestampToMinutes(b.start_time, timezone),
    end: timestampToMinutes(b.end_time, timezone),
  }));

  const blockOutRanges = blockOuts.map((b) => ({
    start: timestampToMinutes(b.start_time, timezone),
    end: timestampToMinutes(b.end_time, timezone),
  }));

  let earliestStartMinutes = openMinutes;
  if (minBookingLeadMinutes > 0) {
    const nowMinutes = timestampToMinutes(new Date().toISOString(), timezone);
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
    if (date === todayStr) {
      earliestStartMinutes = Math.max(openMinutes, nowMinutes + minBookingLeadMinutes);
    }
  }

  const results: AvailableTimeSlot[] = [];

  for (let startMin = openMinutes; startMin + duration <= closeMinutes; startMin += granularity) {
    if (startMin < earliestStartMinutes) continue;
    const endMin = startMin + duration;

    const overlapsBooking = bookingRanges.some((booking) => {
      return startMin < booking.end + buffer && endMin > booking.start - buffer;
    });
    if (overlapsBooking) continue;

    const overlapsBlockOut = blockOutRanges.some((bo) => {
      return startMin < bo.end && endMin > bo.start;
    });
    if (overlapsBlockOut) continue;

    const startTimestamp = minutesToTimestamp(date, startMin, timezone);
    const endTimestamp = minutesToTimestamp(date, endMin, timezone);

    if (timestampToMinutes(startTimestamp, timezone) !== startMin) continue;
    if (timestampToMinutes(endTimestamp, timezone) !== endMin) continue;

    const hourlyRate = resolveHourlyRate(startMin, bay, rule);
    const priceCents = Math.round(hourlyRate * (duration / 60));

    results.push({
      bay_id: bay.id,
      bay_name: bay.name,
      start_time: startTimestamp,
      end_time: endTimestamp,
      price_cents: priceCents,
      duration_minutes: duration,
    });
  }

  return results;
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Fetch pooled availability for a facility group (or standalone bay) on a date.
 * Queries schedule rules, bookings, and block-outs from Supabase, then computes
 * available time windows.
 */
export async function fetchDynamicAvailability(params: {
  orgId: string;
  bayIds: string[];
  date: string;
  duration: number;
  timezone: string;
  minBookingLeadMinutes: number;
}): Promise<AvailableTimeSlot[]> {
  const { orgId, bayIds, date, duration, timezone, minBookingLeadMinutes } = params;

  if (bayIds.length === 0) return [];

  const dayOfWeek = new Date(date + 'T12:00:00').getDay();

  const [rulesResult, baysResult, bookingsResult, blockOutsResult] = await Promise.all([
    supabase
      .from('dynamic_schedule_rules')
      .select('*')
      .in('bay_id', bayIds)
      .eq('day_of_week', dayOfWeek),
    supabase
      .from('bays')
      .select('id, name, hourly_rate_cents')
      .in('id', bayIds)
      .eq('is_active', true),
    supabase
      .from('bookings')
      .select('bay_id, start_time, end_time')
      .in('bay_id', bayIds)
      .eq('date', date)
      .eq('status', 'confirmed'),
    supabase
      .from('schedule_block_outs')
      .select('bay_id, start_time, end_time')
      .in('bay_id', bayIds)
      .eq('date', date),
  ]);

  const rules = (rulesResult.data || []) as DynamicScheduleRule[];
  const bays = (baysResult.data || []) as BayInfo[];
  const bookings = bookingsResult.data || [];
  const blockOuts = blockOutsResult.data || [];

  const rulesMap = new Map<string, DynamicScheduleRule>();
  for (const r of rules) rulesMap.set(r.bay_id, r);

  const bookingsMap = new Map<string, ExistingBooking[]>();
  for (const b of bookings) {
    const list = bookingsMap.get(b.bay_id) || [];
    list.push({ start_time: b.start_time, end_time: b.end_time });
    bookingsMap.set(b.bay_id, list);
  }

  const blockOutsMap = new Map<string, BlockOut[]>();
  for (const bo of blockOuts) {
    const list = blockOutsMap.get(bo.bay_id) || [];
    list.push({ start_time: bo.start_time, end_time: bo.end_time });
    blockOutsMap.set(bo.bay_id, list);
  }

  // Collect all available slots from all bays
  const allSlots: AvailableTimeSlot[] = [];
  for (const bay of bays) {
    const rule = rulesMap.get(bay.id);
    if (!rule) continue;

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

  // Deduplicate by start_time (pooled: show as available if ANY bay has it)
  const seen = new Map<string, AvailableTimeSlot>();
  for (const slot of allSlots) {
    if (!seen.has(slot.start_time)) {
      seen.set(slot.start_time, slot);
    }
  }

  return Array.from(seen.values()).sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );
}

/**
 * Pick the best bay from a group for a booking (consolidation).
 * Prefers the bay with the most existing bookings to pack them together.
 */
export async function pickBayForGroupBooking(params: {
  bayIds: string[];
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
}): Promise<string | null> {
  const { bayIds, date, startTime, endTime, timezone } = params;

  if (bayIds.length === 0) return null;

  const dayOfWeek = new Date(date + 'T12:00:00').getDay();

  const [rulesResult, baysResult, bookingsResult, blockOutsResult] = await Promise.all([
    supabase
      .from('dynamic_schedule_rules')
      .select('*')
      .in('bay_id', bayIds)
      .eq('day_of_week', dayOfWeek),
    supabase
      .from('bays')
      .select('id, name, hourly_rate_cents')
      .in('id', bayIds)
      .eq('is_active', true),
    supabase
      .from('bookings')
      .select('bay_id, start_time, end_time')
      .in('bay_id', bayIds)
      .eq('date', date)
      .eq('status', 'confirmed'),
    supabase
      .from('schedule_block_outs')
      .select('bay_id, start_time, end_time')
      .in('bay_id', bayIds)
      .eq('date', date),
  ]);

  const rules = (rulesResult.data || []) as DynamicScheduleRule[];
  const bays = (baysResult.data || []) as BayInfo[];
  const bookings = bookingsResult.data || [];
  const blockOuts = blockOutsResult.data || [];

  const rulesMap = new Map<string, DynamicScheduleRule>();
  for (const r of rules) rulesMap.set(r.bay_id, r);

  const bookingsMap = new Map<string, ExistingBooking[]>();
  for (const b of bookings) {
    const list = bookingsMap.get(b.bay_id) || [];
    list.push({ start_time: b.start_time, end_time: b.end_time });
    bookingsMap.set(b.bay_id, list);
  }

  const blockOutsMap = new Map<string, BlockOut[]>();
  for (const bo of blockOuts) {
    const list = blockOutsMap.get(bo.bay_id) || [];
    list.push({ start_time: bo.start_time, end_time: bo.end_time });
    blockOutsMap.set(bo.bay_id, list);
  }

  const startMin = timestampToMinutes(startTime, timezone);
  const endMin = timestampToMinutes(endTime, timezone);

  // Sort bays by most bookings first (consolidation)
  const baysByLoad = [...bays].sort((a, b) => {
    const aCount = bookingsMap.get(a.id)?.length || 0;
    const bCount = bookingsMap.get(b.id)?.length || 0;
    return bCount - aCount;
  });

  for (const bay of baysByLoad) {
    const rule = rulesMap.get(bay.id);
    if (!rule) continue;

    const buffer = rule.buffer_minutes;
    const bayBookings = bookingsMap.get(bay.id) || [];
    const bayBlockOuts = blockOutsMap.get(bay.id) || [];

    const overlapsBooking = bayBookings.some((b) => {
      const bStart = timestampToMinutes(b.start_time, timezone);
      const bEnd = timestampToMinutes(b.end_time, timezone);
      return startMin < bEnd + buffer && endMin > bStart - buffer;
    });
    if (overlapsBooking) continue;

    const overlapsBlockOut = bayBlockOuts.some((bo) => {
      const boStart = timestampToMinutes(bo.start_time, timezone);
      const boEnd = timestampToMinutes(bo.end_time, timezone);
      return startMin < boEnd && endMin > boStart;
    });
    if (overlapsBlockOut) continue;

    return bay.id;
  }

  return null;
}
