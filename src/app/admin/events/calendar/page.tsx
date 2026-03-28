import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTodayInTimezone, toTimestamp } from "@/lib/utils";
import { resolveLocationId } from "@/lib/location";
import { EventCalendarWrapper } from "./calendar-wrapper";
import { addMonths, endOfMonth, format } from "date-fns";
import { createNotification } from "@/lib/notifications";
import { createServiceClient } from "@/lib/supabase/service";

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
    status: "draft" | "published",
    confirm?: boolean
  ): Promise<{
    success: boolean;
    count: number;
    error?: string;
    needsConfirmation?: boolean;
    eventsToDelete?: number;
    registrationsToCancel?: number;
  }> {
    "use server";

    const org = await getOrg();
    if (!org) return { success: false, count: 0, error: "Organization not found" };

    const supabase = await createClient();
    const tz = org.timezone || "America/New_York";

    // Fetch the day schedule entries with their saved times
    const { data: entries } = await supabase
      .from("event_day_schedule_entries")
      .select("event_template_id, bay_id_overrides, sort_order, start_time, end_time")
      .eq("day_schedule_id", dayScheduleId)
      .order("sort_order");

    if (!entries || entries.length === 0) {
      return { success: false, count: 0, error: "Day schedule has no entries" };
    }

    // Valid entries (with times)
    const validEntries = entries.filter((e) => e.start_time && e.end_time);
    if (validEntries.length === 0) {
      return { success: false, count: 0, error: "Day schedule entries have no times set" };
    }

    // For each date, check existing events and determine what to keep/delete/insert
    let totalEventsToDelete = 0;
    let totalRegistrationsToCancel = 0;
    let totalCreated = 0;

    // Build schedule fingerprints: template_id + start_time + end_time
    const scheduleFingerprints = new Set(
      validEntries.map((e) => `${e.event_template_id}|${e.start_time}|${e.end_time}`)
    );

    for (const date of dates) {
      const startTs = toTimestamp(date, "00:00", tz);
      const endTs = toTimestamp(date, "23:59", tz);

      // Fetch existing events on this date
      const { data: existingEvents } = await supabase
        .from("events")
        .select("id, template_id, start_time, end_time, status")
        .eq("org_id", org.id)
        .gte("start_time", startTs)
        .lte("start_time", endTs)
        .in("status", ["draft", "published"]);

      type ExistingEvent = { id: string; template_id: string | null; start_time: string; end_time: string; status: string };
      const existing = (existingEvents || []) as ExistingEvent[];

      if (existing.length === 0) {
        // No existing events — just insert all
        if (confirm !== false) {
          for (const entry of validEntries) {
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
              entry.event_template_id, bayIds, [date], status,
              entry.start_time!, entry.end_time!
            );
            totalCreated += result.count;
          }
        }
        continue;
      }

      // Convert existing events to fingerprints for comparison
      const existingFingerprints = new Map<string, ExistingEvent>();
      const eventsToDelete: ExistingEvent[] = [];

      for (const ev of existing) {
        // Convert timestamptz to HH:MM in org timezone
        const evStart = new Date(ev.start_time).toLocaleTimeString("en-GB", {
          timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
        });
        const evEnd = new Date(ev.end_time).toLocaleTimeString("en-GB", {
          timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
        });
        const fp = `${ev.template_id}|${evStart}|${evEnd}`;

        if (scheduleFingerprints.has(fp)) {
          // Exact match — keep this event
          existingFingerprints.set(fp, ev);
        } else {
          // No match — mark for deletion
          eventsToDelete.push(ev);
        }
      }

      // Count registrations on events to delete
      if (eventsToDelete.length > 0) {
        const deleteIds = eventsToDelete.map((e) => e.id);
        const { count: regCount } = await supabase
          .from("event_registrations")
          .select("id", { count: "exact", head: true })
          .in("event_id", deleteIds)
          .in("status", ["confirmed", "waitlisted", "pending_payment"]);

        totalEventsToDelete += eventsToDelete.length;
        totalRegistrationsToCancel += regCount || 0;
      }

      // Determine which schedule entries need new events (not already matched)
      const entriesToInsert = validEntries.filter((entry) => {
        const fp = `${entry.event_template_id}|${entry.start_time}|${entry.end_time}`;
        return !existingFingerprints.has(fp);
      });

      // If preview only (confirm not set), just accumulate counts
      if (confirm === false) continue;

      // ── Confirmed: delete non-matching events and insert new ones ──

      // Cancel and delete non-matching events
      for (const ev of eventsToDelete) {
        await supabase.rpc("cancel_event", { p_event_id: ev.id });
        await supabase.from("events").delete().eq("id", ev.id);
      }

      // Notify registrants of cancelled events
      if (totalRegistrationsToCancel > 0 && eventsToDelete.length > 0) {
        const serviceClient = createServiceClient();
        for (const ev of eventsToDelete) {
          const { data: regs } = await serviceClient
            .from("event_registrations")
            .select("customer_id, profiles:customer_id(id, email, full_name)")
            .eq("event_id", ev.id)
            .eq("status", "cancelled")
            .not("cancelled_at", "is", null);

          if (regs) {
            const eventDate = new Date(ev.start_time).toLocaleDateString("en-US", {
              timeZone: tz, weekday: "long", month: "long", day: "numeric",
            });
            for (const reg of regs) {
              const profile = reg.profiles as unknown as { id: string; email: string; full_name: string } | null;
              if (!profile) continue;
              await createNotification({
                orgId: org.id,
                recipientId: profile.id,
                recipientType: "customer",
                type: "event_cancelled",
                title: "Event Cancelled",
                message: `An event on ${eventDate} has been cancelled. Your registration has been removed.`,
                link: "/my-bookings",
                recipientEmail: profile.email,
                recipientName: profile.full_name,
                orgName: org.name,
              });
            }
          }
        }
      }

      // Insert new events for unmatched entries
      for (const entry of entriesToInsert) {
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
          entry.event_template_id, bayIds, [date], status,
          entry.start_time!, entry.end_time!
        );
        totalCreated += result.count;
      }
    }

    // If there are events to delete with registrations, ask for confirmation first
    if (confirm === false && totalRegistrationsToCancel > 0) {
      return {
        success: true,
        count: 0,
        needsConfirmation: true,
        eventsToDelete: totalEventsToDelete,
        registrationsToCancel: totalRegistrationsToCancel,
      };
    }

    // If preview and no registrations to worry about, just proceed
    if (confirm === false && totalEventsToDelete > 0) {
      return {
        success: true,
        count: 0,
        needsConfirmation: true,
        eventsToDelete: totalEventsToDelete,
        registrationsToCancel: 0,
      };
    }

    revalidatePath("/admin/events/calendar");
    revalidatePath("/admin/events");
    return { success: true, count: totalCreated };
  }

  // ─── Server Action: Update a single event ───

  async function updateEventAction(
    eventId: string,
    updates: {
      date?: string;
      start_time?: string;
      end_time?: string;
      capacity?: number;
      price_cents?: number;
    }
  ): Promise<{ success: boolean; error?: string }> {
    "use server";

    const org = await getOrg();
    const tz = org?.timezone || "America/New_York";

    const supabase = await createClient();

    // Build the actual DB updates
    const dbUpdates: Record<string, unknown> = {};
    if (updates.capacity !== undefined) dbUpdates.capacity = updates.capacity;
    if (updates.price_cents !== undefined) dbUpdates.price_cents = updates.price_cents;

    // Convert HH:MM times to proper timestamptz using org timezone
    if (updates.date && updates.start_time) {
      dbUpdates.start_time = toTimestamp(updates.date, updates.start_time, tz);
    }
    if (updates.date && updates.end_time) {
      let endDate = updates.date;
      if (updates.start_time && updates.end_time <= updates.start_time) {
        const d = new Date(updates.date);
        d.setDate(d.getDate() + 1);
        endDate = d.toISOString().slice(0, 10);
      }
      dbUpdates.end_time = toTimestamp(endDate, updates.end_time, tz);
    }

    const { error } = await supabase
      .from("events")
      .update(dbUpdates)
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

  // ─── Server Action: Bulk delete events for selected dates ───

  async function deleteEventsForDatesAction(
    dates: string[],
    confirm: boolean
  ): Promise<{
    success: boolean;
    eventCount: number;
    registrationCount: number;
    deletedCount?: number;
    error?: string;
  }> {
    "use server";

    const org = await getOrg();
    if (!org) return { success: false, eventCount: 0, registrationCount: 0, error: "Organization not found" };

    const supabase = await createClient();
    const tz = org.timezone || "America/New_York";

    // Find all events on these dates
    const allEventIds: string[] = [];
    for (const date of dates) {
      const startTs = toTimestamp(date, "00:00", tz);
      const endTs = toTimestamp(date, "23:59", tz);
      const { data: events } = await supabase
        .from("events")
        .select("id, status")
        .eq("org_id", org.id)
        .gte("start_time", startTs)
        .lte("start_time", endTs)
        .in("status", ["draft", "published"]);

      if (events) {
        for (const e of events) allEventIds.push(e.id);
      }
    }

    if (allEventIds.length === 0) {
      return { success: true, eventCount: 0, registrationCount: 0, deletedCount: 0 };
    }

    // Count active registrations across all these events
    const { count: regCount } = await supabase
      .from("event_registrations")
      .select("id", { count: "exact", head: true })
      .in("event_id", allEventIds)
      .in("status", ["confirmed", "waitlisted", "pending_payment"]);

    const registrationCount = regCount || 0;

    // If not confirmed, just return the preview counts
    if (!confirm) {
      return { success: true, eventCount: allEventIds.length, registrationCount };
    }

    // ── Confirmed: proceed with deletion ──

    // Collect registrant info before cancelling (for notifications)
    const serviceClient = createServiceClient();
    let registrantsToNotify: { eventName: string; eventDate: string; profileId: string; email: string; fullName: string }[] = [];

    if (registrationCount > 0) {
      const { data: regs } = await serviceClient
        .from("event_registrations")
        .select("event_id, customer_id, events:event_id(name, start_time), profiles:customer_id(id, email, full_name)")
        .in("event_id", allEventIds)
        .in("status", ["confirmed", "waitlisted", "pending_payment"]);

      if (regs) {
        for (const reg of regs) {
          const event = reg.events as unknown as { name: string; start_time: string } | null;
          const profile = reg.profiles as unknown as { id: string; email: string; full_name: string } | null;
          if (!event || !profile) continue;

          const eventDate = new Date(event.start_time).toLocaleDateString("en-US", {
            timeZone: tz,
            weekday: "long",
            month: "long",
            day: "numeric",
          });
          registrantsToNotify.push({
            eventName: event.name,
            eventDate,
            profileId: profile.id,
            email: profile.email,
            fullName: profile.full_name,
          });
        }
      }
    }

    // Unpublish published events first (release slots/blockouts)
    for (const eventId of allEventIds) {
      // cancel_event handles both published and draft: releases slots, cancels registrations
      await supabase.rpc("cancel_event", { p_event_id: eventId });
    }

    // Delete the events
    const { error: deleteError } = await supabase
      .from("events")
      .delete()
      .in("id", allEventIds);

    if (deleteError) {
      return { success: false, eventCount: allEventIds.length, registrationCount, error: deleteError.message };
    }

    // Notify affected registrants
    for (const r of registrantsToNotify) {
      await createNotification({
        orgId: org.id,
        recipientId: r.profileId,
        recipientType: "customer",
        type: "event_cancelled",
        title: "Event Cancelled",
        message: `${r.eventName} on ${r.eventDate} has been cancelled. Your registration has been removed.`,
        link: "/my-bookings",
        recipientEmail: r.email,
        recipientName: r.fullName,
        orgName: org.name,
      });
    }

    revalidatePath("/admin/events/calendar");
    revalidatePath("/admin/events");
    return { success: true, eventCount: allEventIds.length, registrationCount, deletedCount: allEventIds.length };
  }

  // ─── Server Action: Publish an event ───

  async function publishEventAction(
    eventId: string
  ): Promise<{ success: boolean; error?: string }> {
    "use server";

    const supabase = await createClient();
    const { error } = await supabase.rpc("publish_event", {
      p_event_id: eventId,
      p_cancel_conflicting_bookings: false,
    });

    if (error) return { success: false, error: error.message };

    revalidatePath("/admin/events/calendar");
    revalidatePath("/admin/events");
    return { success: true };
  }

  // ─── Server Action: Publish multiple events at once ───

  async function publishAllEventsAction(
    eventIds: string[]
  ): Promise<{ success: boolean; published: number; error?: string }> {
    "use server";

    const supabase = await createClient();
    let published = 0;

    for (const eventId of eventIds) {
      const { error } = await supabase.rpc("publish_event", {
        p_event_id: eventId,
        p_cancel_conflicting_bookings: false,
      });
      if (!error) published++;
    }

    revalidatePath("/admin/events/calendar");
    revalidatePath("/admin/events");
    return { success: published > 0, published };
  }

  // ─── Server Action: Unpublish an event (back to draft) ───

  async function unpublishEventAction(
    eventId: string
  ): Promise<{ success: boolean; cancelledRegistrations?: number; error?: string }> {
    "use server";

    const supabase = await createClient();

    // Call the unpublish RPC which releases slots and cancels registrations
    const { data, error } = await supabase.rpc("unpublish_event", {
      p_event_id: eventId,
    });

    if (error) return { success: false, error: error.message };

    const result = data as { status: string; released_slots: number; cancelled_registrations: number };

    // If registrations were cancelled, notify each registrant
    if (result.cancelled_registrations > 0) {
      const org = await getOrg();
      if (org) {
        const serviceClient = createServiceClient();

        // Fetch the event name for the notification
        const { data: eventData } = await supabase
          .from("events")
          .select("name, start_time")
          .eq("id", eventId)
          .single();

        // Fetch cancelled registrants
        const { data: registrations } = await serviceClient
          .from("event_registrations")
          .select("customer_id, profiles:customer_id(id, email, full_name)")
          .eq("event_id", eventId)
          .eq("status", "cancelled")
          .not("cancelled_at", "is", null);

        if (registrations && eventData) {
          const tz = org.timezone || "America/New_York";
          const eventDate = new Date(eventData.start_time).toLocaleDateString("en-US", {
            timeZone: tz,
            weekday: "long",
            month: "long",
            day: "numeric",
          });

          for (const reg of registrations) {
            const profile = reg.profiles as unknown as { id: string; email: string; full_name: string } | null;
            if (!profile) continue;

            await createNotification({
              orgId: org.id,
              recipientId: profile.id,
              recipientType: "customer",
              type: "event_cancelled",
              title: "Event Cancelled",
              message: `${eventData.name} on ${eventDate} has been cancelled. Your registration has been removed.`,
              link: "/my-bookings",
              recipientEmail: profile.email,
              recipientName: profile.full_name,
              orgName: org.name,
            });
          }
        }
      }
    }

    revalidatePath("/admin/events/calendar");
    revalidatePath("/admin/events");
    return { success: true, cancelledRegistrations: result.cancelled_registrations };
  }

  // ─── Server Action: Unpublish multiple events at once ───

  async function unpublishAllEventsAction(
    eventIds: string[]
  ): Promise<{ success: boolean; unpublished: number; cancelledRegistrations: number; error?: string }> {
    "use server";

    const org = await getOrg();
    if (!org) return { success: false, unpublished: 0, cancelledRegistrations: 0, error: "Organization not found" };

    const supabase = await createClient();
    const serviceClient = createServiceClient();
    const tz = org.timezone || "America/New_York";
    let unpublished = 0;
    let totalCancelledRegs = 0;

    for (const eventId of eventIds) {
      const { data, error } = await supabase.rpc("unpublish_event", {
        p_event_id: eventId,
      });
      if (error) continue;

      const res = data as { cancelled_registrations: number };
      unpublished++;
      totalCancelledRegs += res.cancelled_registrations;

      // Notify cancelled registrants
      if (res.cancelled_registrations > 0) {
        const { data: eventData } = await supabase
          .from("events")
          .select("name, start_time")
          .eq("id", eventId)
          .single();

        const { data: regs } = await serviceClient
          .from("event_registrations")
          .select("customer_id, profiles:customer_id(id, email, full_name)")
          .eq("event_id", eventId)
          .eq("status", "cancelled")
          .not("cancelled_at", "is", null);

        if (regs && eventData) {
          const eventDate = new Date(eventData.start_time).toLocaleDateString("en-US", {
            timeZone: tz, weekday: "long", month: "long", day: "numeric",
          });
          for (const reg of regs) {
            const profile = reg.profiles as unknown as { id: string; email: string; full_name: string } | null;
            if (!profile) continue;
            await createNotification({
              orgId: org.id,
              recipientId: profile.id,
              recipientType: "customer",
              type: "event_cancelled",
              title: "Event Cancelled",
              message: `${eventData.name} on ${eventDate} has been cancelled. Your registration has been removed.`,
              link: "/my-bookings",
              recipientEmail: profile.email,
              recipientName: profile.full_name,
              orgName: org.name,
            });
          }
        }
      }
    }

    revalidatePath("/admin/events/calendar");
    revalidatePath("/admin/events");
    return { success: unpublished > 0, unpublished, cancelledRegistrations: totalCancelledRegs };
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
      onPublishEvent={publishEventAction}
      onUnpublishEvent={unpublishEventAction}
      onDeleteEventsForDates={deleteEventsForDatesAction}
      onPublishAllEvents={publishAllEventsAction}
      onUnpublishAllEvents={unpublishAllEventsAction}
    />
  );
}
