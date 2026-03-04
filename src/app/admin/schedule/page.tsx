import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTodayInTimezone, toTimestamp } from "@/lib/utils";
import { ScheduleCalendar } from "@/components/admin/schedule-calendar";
import { addMonths, endOfMonth, format } from "date-fns";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, scheduling_type")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function ScheduleManagerPage() {
  const org = await getOrg();
  if (!org) redirect("/");

  if (org.scheduling_type === "dynamic") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Schedule
          </h1>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400">
          Your facility uses Dynamic Scheduling. Available times are calculated
          automatically from your schedule rules.{" "}
          <a
            href="/admin/schedule/rules"
            className="font-medium underline underline-offset-2"
          >
            Manage Schedule Rules
          </a>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const today = getTodayInTimezone(org.timezone);

  // Date range: today through end of 12th month from now
  const todayDate = new Date(today + "T12:00:00");
  const endDate = endOfMonth(addMonths(todayDate, 12));
  const endDateStr = format(endDate, "yyyy-MM-dd");

  // Fetch bays, schedules (for coverage), and templates in parallel
  const [baysResult, schedulesResult, templatesResult] = await Promise.all([
    supabase
      .from("bays")
      .select("id, name, hourly_rate_cents")
      .eq("org_id", org.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("bay_schedules")
      .select("date, bay_id")
      .eq("org_id", org.id)
      .gte("date", today)
      .lte("date", endDateStr),
    supabase
      .from("schedule_templates")
      .select("id, name, template_slots(id)")
      .eq("org_id", org.id)
      .order("created_at"),
  ]);

  const bays = baysResult.data || [];
  const schedules = schedulesResult.data || [];
  const templates = (templatesResult.data || []).map((t) => ({
    id: t.id,
    name: t.name,
    slotCount: t.template_slots?.length || 0,
  }));

  // Aggregate: date → count of bays with published schedules
  const coverageMap: Record<string, number> = {};
  for (const s of schedules) {
    coverageMap[s.date] = (coverageMap[s.date] || 0) + 1;
  }

  // ─── Server Action: Apply template to selected dates × bays ───

  async function applyTemplateAction(
    templateId: string,
    bayIds: string[],
    dates: string[]
  ): Promise<{ success: boolean; count: number; error?: string }> {
    "use server";

    const org = await getOrg();
    if (!org) return { success: false, count: 0, error: "Organization not found" };

    const supabase = await createClient();

    // 1. Fetch template slots
    const { data: templateSlots } = await supabase
      .from("template_slots")
      .select("id, start_time, end_time")
      .eq("template_id", templateId);

    if (!templateSlots?.length) {
      return { success: false, count: 0, error: "Template has no time slots" };
    }

    // 2. Fetch per-bay price overrides for this template
    const { data: overrides } = await supabase
      .from("template_bay_overrides")
      .select("template_slot_id, bay_id, price_cents")
      .eq("template_id", templateId)
      .in("bay_id", bayIds);

    const overrideMap = new Map<string, number>();
    for (const o of overrides || []) {
      overrideMap.set(`${o.template_slot_id}:${o.bay_id}`, o.price_cents);
    }

    // 3. Fetch bay hourly rates
    const { data: baysData } = await supabase
      .from("bays")
      .select("id, hourly_rate_cents")
      .in("id", bayIds);

    const bayRates = new Map<string, number>();
    for (const b of baysData || []) {
      bayRates.set(b.id, b.hourly_rate_cents);
    }

    // 4. Batch upsert bay_schedules for all date × bay combinations
    const scheduleRows = dates.flatMap((date) =>
      bayIds.map((bayId) => ({
        bay_id: bayId,
        org_id: org.id,
        date,
        template_id: templateId,
      }))
    );

    const { data: upsertedSchedules, error: upsertError } = await supabase
      .from("bay_schedules")
      .upsert(scheduleRows, { onConflict: "bay_id,date" })
      .select("id, bay_id, date");

    if (upsertError || !upsertedSchedules?.length) {
      return {
        success: false,
        count: 0,
        error: upsertError?.message || "Failed to create schedules",
      };
    }

    // 5. Delete old slots for all affected schedules
    const scheduleIds = upsertedSchedules.map((s) => s.id);
    await supabase
      .from("bay_schedule_slots")
      .delete()
      .in("bay_schedule_id", scheduleIds);

    // 6. Build all concrete slots with pro-rated pricing (respecting overrides)
    const allConcreteSlots: {
      bay_schedule_id: string;
      org_id: string;
      start_time: string;
      end_time: string;
      price_cents: number;
      status: "available";
    }[] = [];

    for (const schedule of upsertedSchedules) {
      const hourlyRate = bayRates.get(schedule.bay_id) || 0;

      for (const ts of templateSlots) {
        const [startH, startM] = ts.start_time.split(":").map(Number);
        const [endH, endM] = ts.end_time.split(":").map(Number);
        const durationMinutes = endH * 60 + endM - (startH * 60 + startM);

        const overridePrice = overrideMap.get(`${ts.id}:${schedule.bay_id}`);
        const priceCents =
          overridePrice !== undefined
            ? overridePrice
            : Math.round(hourlyRate * (durationMinutes / 60));

        allConcreteSlots.push({
          bay_schedule_id: schedule.id,
          org_id: org.id,
          start_time: toTimestamp(schedule.date, ts.start_time, org.timezone),
          end_time: toTimestamp(schedule.date, ts.end_time, org.timezone),
          price_cents: priceCents,
          status: "available",
        });
      }
    }

    // 7. Batch insert concrete slots (chunked for large batches)
    const CHUNK_SIZE = 500;
    for (let i = 0; i < allConcreteSlots.length; i += CHUNK_SIZE) {
      const chunk = allConcreteSlots.slice(i, i + CHUNK_SIZE);
      const { error: insertError } = await supabase
        .from("bay_schedule_slots")
        .insert(chunk);

      if (insertError) {
        return {
          success: false,
          count: upsertedSchedules.length,
          error: `Partial failure: ${insertError.message}`,
        };
      }
    }

    revalidatePath("/admin/schedule");
    return { success: true, count: upsertedSchedules.length };
  }

  // ─── Server Action: Clear schedules for selected dates × bays ───

  async function clearSchedulesAction(
    bayIds: string[],
    dates: string[]
  ): Promise<{
    success: boolean;
    cleared: number;
    skippedWithBookings: number;
    error?: string;
  }> {
    "use server";

    const org = await getOrg();
    if (!org)
      return {
        success: false,
        cleared: 0,
        skippedWithBookings: 0,
        error: "Organization not found",
      };

    const supabase = await createClient();

    // 1. Find all bay_schedules for the given dates × bays
    const { data: schedules, error: fetchError } = await supabase
      .from("bay_schedules")
      .select("id, bay_id, date")
      .eq("org_id", org.id)
      .in("bay_id", bayIds)
      .in("date", dates)
      .limit(5000);

    if (fetchError) {
      return {
        success: false,
        cleared: 0,
        skippedWithBookings: 0,
        error: fetchError.message,
      };
    }

    if (!schedules || schedules.length === 0) {
      return { success: true, cleared: 0, skippedWithBookings: 0 };
    }

    const scheduleIds = schedules.map((s) => s.id);

    // 2. Fetch all slots for these schedules (chunked to avoid limit issues)
    const allSlots: Array<{
      id: string;
      bay_schedule_id: string;
      status: string;
    }> = [];
    const FETCH_CHUNK = 200;
    for (let i = 0; i < scheduleIds.length; i += FETCH_CHUNK) {
      const chunk = scheduleIds.slice(i, i + FETCH_CHUNK);
      const { data } = await supabase
        .from("bay_schedule_slots")
        .select("id, bay_schedule_id, status")
        .in("bay_schedule_id", chunk)
        .limit(10000);
      if (data) allSlots.push(...data);
    }

    // Group slots by schedule
    const slotsBySchedule = new Map<
      string,
      Array<{ id: string; status: string }>
    >();
    for (const slot of allSlots) {
      const list = slotsBySchedule.get(slot.bay_schedule_id) || [];
      list.push(slot);
      slotsBySchedule.set(slot.bay_schedule_id, list);
    }

    let cleared = 0;
    let skippedWithBookings = 0;
    const slotsToDelete: string[] = [];
    const schedulesToDelete: string[] = [];

    for (const sched of schedules) {
      const slots = slotsBySchedule.get(sched.id) || [];
      const bookedSlots = slots.filter((s) => s.status === "booked");
      const nonBookedSlots = slots.filter((s) => s.status !== "booked");

      if (bookedSlots.length > 0) {
        // Has active bookings — only remove non-booked slots
        skippedWithBookings++;
        for (const s of nonBookedSlots) {
          slotsToDelete.push(s.id);
        }
      } else {
        // No bookings — fully clear
        cleared++;
        for (const s of slots) {
          slotsToDelete.push(s.id);
        }
        schedulesToDelete.push(sched.id);
      }
    }

    // 3. Delete non-booked slots in chunks
    const DELETE_CHUNK = 500;
    for (let i = 0; i < slotsToDelete.length; i += DELETE_CHUNK) {
      const chunk = slotsToDelete.slice(i, i + DELETE_CHUNK);
      const { error } = await supabase
        .from("bay_schedule_slots")
        .delete()
        .in("id", chunk);
      if (error) {
        return {
          success: false,
          cleared,
          skippedWithBookings,
          error: error.message,
        };
      }
    }

    // 4. Delete empty bay_schedules
    if (schedulesToDelete.length > 0) {
      for (let i = 0; i < schedulesToDelete.length; i += DELETE_CHUNK) {
        const chunk = schedulesToDelete.slice(i, i + DELETE_CHUNK);
        const { error } = await supabase
          .from("bay_schedules")
          .delete()
          .in("id", chunk);
        if (error) {
          return {
            success: false,
            cleared,
            skippedWithBookings,
            error: error.message,
          };
        }
      }
    }

    revalidatePath("/admin/schedule");
    return { success: true, cleared, skippedWithBookings };
  }

  return (
    <ScheduleCalendar
      today={today}
      totalBays={bays.length}
      coverageMap={coverageMap}
      templates={templates}
      bays={bays}
      orgId={org.id}
      timezone={org.timezone}
      onApplyTemplate={applyTemplateAction}
      onClearSchedules={clearSchedulesAction}
    />
  );
}
