import type { SupabaseClient } from "@supabase/supabase-js";
import { toTimestamp } from "@/lib/utils";

/**
 * After schedule slots are (re)created, restore event_hold status for any
 * published events that overlap the given bays and dates.
 *
 * Mirrors the logic in publish_event() RPC (migration 00039):
 *   UPDATE bay_schedule_slots SET status='event_hold', event_id=...
 *   WHERE slot overlaps event time range AND bay is assigned to event
 */
export async function restoreEventHolds(
  supabase: SupabaseClient,
  orgId: string,
  bayIds: string[],
  dates: string[],
  timezone: string
): Promise<void> {
  if (bayIds.length === 0 || dates.length === 0) return;

  // Compute the overall time window for all dates
  const sortedDates = [...dates].sort();
  const windowStart = toTimestamp(sortedDates[0], "00:00:00", timezone);
  const lastDate = sortedDates[sortedDates.length - 1];
  // Next day after the last date
  const nextDay = new Date(lastDate + "T12:00:00Z");
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().split("T")[0];
  const windowEnd = toTimestamp(nextDayStr, "00:00:00", timezone);

  // Find published events that overlap this window and use these bays
  const { data: eventBays } = await supabase
    .from("event_bays")
    .select("event_id, bay_id, events!inner(id, start_time, end_time, status)")
    .in("bay_id", bayIds)
    .eq("events.status", "published")
    .lt("events.start_time", windowEnd)
    .gt("events.end_time", windowStart);

  if (!eventBays || eventBays.length === 0) return;

  // Group by event_id so we issue one update per event
  const eventMap = new Map<string, { start_time: string; end_time: string; bayIds: string[] }>();
  for (const eb of eventBays) {
    const evt = eb.events as unknown as { id: string; start_time: string; end_time: string };
    if (!eventMap.has(eb.event_id)) {
      eventMap.set(eb.event_id, {
        start_time: evt.start_time,
        end_time: evt.end_time,
        bayIds: [],
      });
    }
    eventMap.get(eb.event_id)!.bayIds.push(eb.bay_id);
  }

  // For each event, get the bay_schedule IDs for the relevant bays,
  // then update overlapping available slots to event_hold
  for (const [eventId, info] of eventMap) {
    // Get bay_schedule records for the event's bays on the target dates
    const { data: schedules } = await supabase
      .from("bay_schedules")
      .select("id")
      .in("bay_id", info.bayIds)
      .in("date", dates)
      .eq("org_id", orgId);

    if (!schedules || schedules.length === 0) continue;

    const scheduleIds = schedules.map((s) => s.id);

    // Update available slots that overlap the event time range
    await supabase
      .from("bay_schedule_slots")
      .update({ status: "event_hold" as string, event_id: eventId })
      .in("bay_schedule_id", scheduleIds)
      .eq("status", "available")
      .lt("start_time", info.end_time)
      .gt("end_time", info.start_time);
  }
}
