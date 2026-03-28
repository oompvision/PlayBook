import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTodayInTimezone, toTimestamp } from "@/lib/utils";
import { resolveLocationId } from "@/lib/location";
import { EventCalendarWrapper } from "./calendar-wrapper";
import { addMonths, endOfMonth, format } from "date-fns";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, membership_tiers_enabled")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function EventCalendarPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParamsPromise;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const locationId = await resolveLocationId(org.id, params.location);
  const today = getTodayInTimezone(org.timezone);

  // Date range: today through end of 12th month from now
  const todayDate = new Date(today + "T12:00:00");
  const endDate = endOfMonth(addMonths(todayDate, 12));
  const endDateStr = format(endDate, "yyyy-MM-dd");

  // Fetch bays, event templates, day schedules, and events in parallel
  const baysQuery = supabase
    .from("bays")
    .select("id, name")
    .eq("org_id", org.id)
    .eq("is_active", true);
  if (locationId) baysQuery.eq("location_id", locationId);

  const eventTemplatesQuery = supabase
    .from("event_templates")
    .select("id, name, config")
    .eq("org_id", org.id)
    .order("created_at");

  const daySchedulesQuery = supabase
    .from("event_day_schedules")
    .select("id, name, event_day_schedule_entries(id)")
    .eq("org_id", org.id)
    .order("created_at");

  // Fetch events in the date range
  const startTimestamp = toTimestamp(today, "00:00", org.timezone);
  const endTimestamp = toTimestamp(endDateStr, "23:59", org.timezone);
  const eventsQuery = supabase
    .from("events")
    .select("id, name, start_time, end_time, status, template_id")
    .eq("org_id", org.id)
    .gte("start_time", startTimestamp)
    .lte("start_time", endTimestamp)
    .in("status", ["draft", "published"]);
  if (locationId) eventsQuery.eq("location_id", locationId);

  const [baysResult, templatesResult, daySchedulesResult, eventsResult] =
    await Promise.all([
      baysQuery.order("sort_order"),
      eventTemplatesQuery,
      daySchedulesQuery,
      eventsQuery.order("start_time"),
    ]);

  const bays = (baysResult.data || []).map((b) => ({ id: b.id, name: b.name }));

  const eventTemplates = (templatesResult.data || []).map((t) => {
    const config = (t.config || {}) as Record<string, unknown>;
    return {
      id: t.id,
      name: t.name,
      color: (config.color as string) || "#3B82F6",
      bay_ids: (config.bay_ids as string[]) || [],
    };
  });

  const daySchedules = (daySchedulesResult.data || []).map((ds) => ({
    id: ds.id,
    name: ds.name,
    entryCount: ds.event_day_schedule_entries?.length || 0,
  }));

  // Build eventMap: date string → array of event summaries
  // We need to convert timestamptz to local date in the org's timezone
  const eventMap: Record<
    string,
    { id: string; name: string; templateId: string | null; color: string; status: string }[]
  > = {};

  // Build a template color lookup
  const templateColorMap = new Map<string, string>();
  for (const t of eventTemplates) {
    templateColorMap.set(t.id, t.color);
  }

  for (const event of eventsResult.data || []) {
    // Convert start_time to date in org timezone
    const dateInTz = new Date(event.start_time).toLocaleDateString("en-CA", {
      timeZone: org.timezone,
    }); // "YYYY-MM-DD"
    if (!eventMap[dateInTz]) eventMap[dateInTz] = [];
    eventMap[dateInTz].push({
      id: event.id,
      name: event.name,
      templateId: event.template_id,
      color: event.template_id
        ? templateColorMap.get(event.template_id) || "#3B82F6"
        : "#3B82F6",
      status: event.status,
    });
  }

  // ─── Server Action: Apply event template to selected dates ───

  async function applyEventTemplateAction(
    templateId: string,
    bayIds: string[],
    dates: string[],
    status: "draft" | "published",
    startTime?: string,
    endTime?: string
  ): Promise<{ success: boolean; count: number; error?: string }> {
    "use server";

    if (!startTime || !endTime) {
      return { success: false, count: 0, error: "Start time and end time are required" };
    }

    const org = await getOrg();
    if (!org) return { success: false, count: 0, error: "Organization not found" };

    const supabase = await createClient();
    const tz = org.timezone || "America/New_York";

    // Fetch the template config
    const { data: tpl } = await supabase
      .from("event_templates")
      .select("id, name, config")
      .eq("id", templateId)
      .single();

    if (!tpl) return { success: false, count: 0, error: "Template not found" };

    const config = (tpl.config || {}) as Record<string, unknown>;
    const capacity = (config.capacity as number) || 12;
    const priceCents = (config.price_cents as number) || 0;
    const membersOnly = (config.members_only as boolean) || false;
    const memberEnrollDays = (config.member_enrollment_days_before as number) ?? null;
    const guestEnrollDays = (config.guest_enrollment_days_before as number) ?? 7;
    const waitlistHours = (config.waitlist_promotion_hours as number) ?? 24;
    const description = (config.description as string) || null;

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, count: 0, error: "Not authenticated" };

    // Resolve location
    const locationId = await resolveLocationId(org.id, null);

    let created = 0;
    const errors: string[] = [];

    for (const date of dates) {
      // Build timestamptz from date + template times
      const startTimestamp = toTimestamp(date, startTime, tz);
      let endDate = date;
      if (endTime <= startTime) {
        const d = new Date(date);
        d.setDate(d.getDate() + 1);
        endDate = d.toISOString().slice(0, 10);
      }
      const endTimestamp = toTimestamp(endDate, endTime, tz);

      const { data: newEvent, error: eventError } = await supabase
        .from("events")
        .insert({
          org_id: org.id,
          location_id: locationId,
          name: tpl.name,
          description,
          start_time: startTimestamp,
          end_time: endTimestamp,
          capacity,
          price_cents: priceCents,
          members_only: membersOnly,
          member_enrollment_days_before: memberEnrollDays,
          guest_enrollment_days_before: guestEnrollDays,
          waitlist_promotion_hours: waitlistHours,
          status,
          template_id: templateId,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (eventError || !newEvent) {
        errors.push(`${date}: ${eventError?.message || "Failed"}`);
        continue;
      }

      // Insert bay assignments
      if (bayIds.length > 0) {
        await supabase.from("event_bays").insert(
          bayIds.map((bayId) => ({ event_id: newEvent.id, bay_id: bayId }))
        );
      }

      // If publishing, call publish_event RPC to block slots
      if (status === "published") {
        await supabase.rpc("publish_event", {
          p_event_id: newEvent.id,
          p_cancel_conflicting_bookings: false,
        });
      }

      created++;
    }

    revalidatePath("/admin/events/calendar");
    revalidatePath("/admin/events");

    if (errors.length > 0 && created === 0) {
      return { success: false, count: 0, error: errors[0] };
    }

    return { success: true, count: created };
  }

  // ─── Server Action: Apply day schedule to selected dates ───

  async function applyDayScheduleAction(
    dayScheduleId: string,
    dates: string[],
    status: "draft" | "published"
  ): Promise<{ success: boolean; count: number; error?: string }> {
    "use server";

    const org = await getOrg();
    if (!org) return { success: false, count: 0, error: "Organization not found" };

    const supabase = await createClient();

    // Fetch the day schedule entries with their saved times
    const { data: entries } = await supabase
      .from("event_day_schedule_entries")
      .select("event_template_id, bay_id_overrides, sort_order, start_time, end_time")
      .eq("day_schedule_id", dayScheduleId)
      .order("sort_order");

    if (!entries || entries.length === 0) {
      return { success: false, count: 0, error: "Day schedule has no entries" };
    }

    let totalCreated = 0;

    for (const entry of entries) {
      if (!entry.start_time || !entry.end_time) continue;

      // Get the template's bay_ids (use overrides if set)
      let bayIds: string[] = [];
      if (entry.bay_id_overrides && entry.bay_id_overrides.length > 0) {
        bayIds = entry.bay_id_overrides;
      } else {
        const { data: tpl } = await supabase
          .from("event_templates")
          .select("config")
          .eq("id", entry.event_template_id)
          .single();
        if (tpl?.config) {
          bayIds = ((tpl.config as Record<string, unknown>).bay_ids as string[]) || [];
        }
      }

      const result = await applyEventTemplateAction(
        entry.event_template_id,
        bayIds,
        dates,
        status,
        entry.start_time,
        entry.end_time
      );
      totalCreated += result.count;
    }

    return { success: true, count: totalCreated };
  }

  // ─── Server Action: Update a single event ───

  async function updateEventAction(
    eventId: string,
    updates: {
      start_time?: string;
      end_time?: string;
      capacity?: number;
      price_cents?: number;
    }
  ): Promise<{ success: boolean; error?: string }> {
    "use server";

    const supabase = await createClient();
    const { error } = await supabase
      .from("events")
      .update(updates)
      .eq("id", eventId);

    if (error) return { success: false, error: error.message };

    revalidatePath("/admin/events/calendar");
    revalidatePath("/admin/events");
    return { success: true };
  }

  // ─── Server Action: Delete a draft event ───

  async function deleteEventAction(
    eventId: string
  ): Promise<{ success: boolean; error?: string }> {
    "use server";

    const supabase = await createClient();
    // Only delete draft events
    const { error } = await supabase
      .from("events")
      .delete()
      .eq("id", eventId)
      .eq("status", "draft");

    if (error) return { success: false, error: error.message };

    revalidatePath("/admin/events/calendar");
    revalidatePath("/admin/events");
    return { success: true };
  }

  // ─── Server Action: Add event from template to a specific date ───

  async function addEventFromTemplateAction(
    templateId: string,
    date: string,
    startTime?: string,
    endTime?: string
  ): Promise<{ success: boolean; error?: string }> {
    "use server";

    if (!startTime || !endTime) {
      return { success: false, error: "Start time and end time are required" };
    }

    const org = await getOrg();
    if (!org) return { success: false, error: "Organization not found" };

    const supabase = await createClient();
    const { data: tpl } = await supabase
      .from("event_templates")
      .select("config")
      .eq("id", templateId)
      .single();

    const bayIds = tpl?.config
      ? ((tpl.config as Record<string, unknown>).bay_ids as string[]) || []
      : [];

    const result = await applyEventTemplateAction(templateId, bayIds, [date], "draft", startTime, endTime);
    return { success: result.success, error: result.error };
  }

  // ─── Server Action: Save day's events as a Day Schedule template ───

  async function saveDayScheduleAction(
    date: string,
    name: string
  ): Promise<{ success: boolean; error?: string }> {
    "use server";

    const org = await getOrg();
    if (!org) return { success: false, error: "Organization not found" };

    const supabase = await createClient();
    const tz = org.timezone || "America/New_York";

    // Find all events on this date (include start_time and end_time for saving)
    const startTs = toTimestamp(date, "00:00", tz);
    const endTs = toTimestamp(date, "23:59", tz);
    const { data: events } = await supabase
      .from("events")
      .select("id, template_id, start_time, end_time")
      .eq("org_id", org.id)
      .gte("start_time", startTs)
      .lte("start_time", endTs)
      .in("status", ["draft", "published"])
      .order("start_time");

    if (!events || events.length === 0) {
      return { success: false, error: "No events found on this date" };
    }

    // Only include events that have a template_id
    const templatedEvents = events.filter((e) => e.template_id);
    if (templatedEvents.length === 0) {
      return { success: false, error: "No template-based events found on this date" };
    }

    // Resolve location
    const locationId = await resolveLocationId(org.id, null);

    // Create the day schedule
    const { data: daySchedule, error: dsError } = await supabase
      .from("event_day_schedules")
      .insert({
        org_id: org.id,
        location_id: locationId,
        name,
      })
      .select("id")
      .single();

    if (dsError || !daySchedule) {
      return { success: false, error: dsError?.message || "Failed to create day schedule" };
    }

    // Create entries with the actual event times (as HH:MM in org timezone)
    const entries = templatedEvents.map((e, i) => {
      // Convert timestamptz to HH:MM in org timezone
      const startLocal = new Date(e.start_time).toLocaleTimeString("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const endLocal = new Date(e.end_time).toLocaleTimeString("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      return {
        day_schedule_id: daySchedule.id,
        event_template_id: e.template_id!,
        sort_order: i,
        start_time: startLocal,
        end_time: endLocal,
      };
    });

    const { error: entryError } = await supabase
      .from("event_day_schedule_entries")
      .insert(entries);

    if (entryError) {
      return { success: false, error: entryError.message };
    }

    revalidatePath("/admin/events/calendar");
    return { success: true };
  }

  return (
    <EventCalendarWrapper
      today={today}
      timezone={org.timezone || "America/New_York"}
      orgId={org.id}
      eventMap={eventMap}
      eventTemplates={eventTemplates}
      daySchedules={daySchedules}
      bays={bays}
      onApplyEventTemplate={applyEventTemplateAction}
      onApplyDaySchedule={applyDayScheduleAction}
      onUpdateEvent={updateEventAction}
      onDeleteEvent={deleteEventAction}
      onAddEventFromTemplate={addEventFromTemplateAction}
      onSaveDaySchedule={saveDayScheduleAction}
    />
  );
}
