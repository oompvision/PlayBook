import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toTimestamp, formatTimeInZone, getTodayInTimezone } from "@/lib/utils";
import { resolveLocationId } from "@/lib/location";
import {
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Clock,
  Layers,
  CheckCircle2,
  XCircle,
  Ban,
  Plus,
  Trash2,
  CalendarDays,
} from "lucide-react";
import { restoreEventHolds } from "@/lib/schedule-utils";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone")
    .eq("slug", slug)
    .single();
  return data;
}

function formatDateHeading(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const STATUS_COLORS: Record<string, { dot: string; bg: string; text: string }> = {
  available: { dot: "bg-green-400", bg: "bg-green-50 border-green-200", text: "text-green-700" },
  booked: { dot: "bg-blue-400", bg: "bg-blue-50 border-blue-200", text: "text-blue-700" },
  blocked: { dot: "bg-gray-400", bg: "bg-gray-100 border-gray-200", text: "text-gray-600" },
  event_hold: { dot: "bg-purple-400", bg: "bg-purple-50 border-purple-200", text: "text-purple-700" },
};

export default async function DayEditorPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    bay?: string;
    error?: string;
    saved?: string;
    location?: string;
  }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const locationId = await resolveLocationId(org.id, params.location);
  const today = getTodayInTimezone(org.timezone);
  const date = params.date || today;

  // Get bays and templates
  const baysQuery = supabase.from("bays").select("id, name, is_active, sort_order, hourly_rate_cents").eq("org_id", org.id).eq("is_active", true);
  if (locationId) baysQuery.eq("location_id", locationId);

  const templatesQuery = supabase.from("schedule_templates").select("id, name").eq("org_id", org.id);
  if (locationId) templatesQuery.eq("location_id", locationId);

  const [baysResult, templatesResult] = await Promise.all([
    baysQuery.order("sort_order"),
    templatesQuery.order("name"),
  ]);

  const bays = baysResult.data || [];
  const templates = templatesResult.data || [];

  // Get schedules + slots for this date
  const schedulesQuery = supabase.from("bay_schedules").select("*, schedule_templates(name), bay_schedule_slots(*)").eq("org_id", org.id).eq("date", date);
  if (locationId) schedulesQuery.eq("location_id", locationId);
  const { data: schedules } = await schedulesQuery;

  // Build lookup: bay_id → schedule with slots
  const scheduleByBay = new Map<string, (typeof schedules extends (infer T)[] | null ? T : never)>();
  if (schedules) {
    for (const s of schedules) {
      scheduleByBay.set(s.bay_id, s);
    }
  }

  // Compute day metrics
  const allSlots = schedules?.flatMap((s) => s.bay_schedule_slots) || [];
  const availableCount = allSlots.filter((s) => s.status === "available").length;
  const bookedCount = allSlots.filter((s) => s.status === "booked").length;
  const blockedCount = allSlots.filter((s) => s.status === "blocked").length;
  const eventHoldCount = allSlots.filter((s) => s.status === "event_hold").length;

  // If a specific bay is focused, scroll to it
  const focusedBayId = params.bay || null;

  // Navigation dates
  const prevDate = new Date(date + "T12:00:00");
  prevDate.setDate(prevDate.getDate() - 1);
  const nextDate = new Date(date + "T12:00:00");
  nextDate.setDate(nextDate.getDate() + 1);

  async function applyTemplateToDay(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();

    const templateId = formData.get("template_id") as string;
    const bayId = formData.get("bay_id") as string;
    const date = formData.get("date") as string;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";

    const { data: templateSlots } = await supabase
      .from("template_slots")
      .select("*")
      .eq("template_id", templateId);

    if (!templateSlots || templateSlots.length === 0) {
      redirect(
        `/admin/schedule/day?date=${date}&bay=${bayId}&error=${encodeURIComponent("Template has no slots")}${locParam}`
      );
    }

    // Fetch bay's location_id for the bay_schedule record
    const { data: bayInfo } = await supabase
      .from("bays").select("location_id").eq("id", bayId).single();

    // Upsert bay_schedule
    const { data: schedule, error: schedError } = await supabase
      .from("bay_schedules")
      .upsert(
        { bay_id: bayId, org_id: org.id, date, template_id: templateId, location_id: bayInfo?.location_id },
        { onConflict: "bay_id,date" }
      )
      .select("id")
      .single();

    if (schedError || !schedule) {
      redirect(
        `/admin/schedule/day?date=${date}&bay=${bayId}&error=${encodeURIComponent(schedError?.message || "Failed to create schedule")}${locParam}`
      );
    }

    // Delete old slots
    await supabase
      .from("bay_schedule_slots")
      .delete()
      .eq("bay_schedule_id", schedule.id);

    // Fetch bay hourly rate for price calculation
    const { data: bayData } = await supabase
      .from("bays")
      .select("hourly_rate_cents")
      .eq("id", bayId)
      .single();

    const hourlyRateCents = bayData?.hourly_rate_cents || 0;

    // Insert new (timezone-aware)
    // Price is pro-rated from the bay's hourly rate based on slot duration
    const concreteSlots = templateSlots.map((ts) => {
      const [startH, startM] = ts.start_time.split(":").map(Number);
      const [endH, endM] = ts.end_time.split(":").map(Number);
      const durationMinutes = (endH * 60 + endM) - (startH * 60 + startM);
      const priceCents = Math.round(hourlyRateCents * (durationMinutes / 60));

      return {
        bay_schedule_id: schedule.id,
        org_id: org.id,
        location_id: bayInfo?.location_id,
        start_time: toTimestamp(date, ts.start_time, org.timezone),
        end_time: toTimestamp(date, ts.end_time, org.timezone),
        price_cents: priceCents,
        status: "available" as const,
      };
    });

    await supabase.from("bay_schedule_slots").insert(concreteSlots);

    // Restore event holds for any published events overlapping this bay/date
    await restoreEventHolds(supabase, org.id, [bayId], [date], org.timezone);

    revalidatePath("/admin/schedule/day");
    redirect(`/admin/schedule/day?date=${date}&bay=${bayId}&saved=true${locParam}`);
  }

  async function addSlot(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();

    const bayId = formData.get("bay_id") as string;
    const date = formData.get("date") as string;
    const startTime = formData.get("start_time") as string;
    const endTime = formData.get("end_time") as string;
    const price = parseFloat(formData.get("price") as string) || 0;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";

    // Fetch bay's location_id for the bay_schedule record
    const { data: bayInfo } = await supabase
      .from("bays").select("location_id").eq("id", bayId).single();

    // Ensure bay_schedule exists
    let { data: schedule } = await supabase
      .from("bay_schedules")
      .select("id")
      .eq("bay_id", bayId)
      .eq("date", date)
      .single();

    if (!schedule) {
      const { data: newSchedule } = await supabase
        .from("bay_schedules")
        .insert({ bay_id: bayId, org_id: org.id, date, location_id: bayInfo?.location_id })
        .select("id")
        .single();
      schedule = newSchedule;
    }

    if (!schedule) {
      redirect(
        `/admin/schedule/day?date=${date}&bay=${bayId}&error=${encodeURIComponent("Failed to create schedule")}${locParam}`
      );
    }

    const { error } = await supabase.from("bay_schedule_slots").insert({
      bay_schedule_id: schedule.id,
      org_id: org.id,
      location_id: bayInfo?.location_id,
      start_time: toTimestamp(date, startTime, org.timezone),
      end_time: toTimestamp(date, endTime, org.timezone),
      price_cents: Math.round(price * 100),
      status: "available",
    });

    if (error) {
      redirect(
        `/admin/schedule/day?date=${date}&bay=${bayId}&error=${encodeURIComponent(error.message)}${locParam}`
      );
    }

    // Restore event holds for any published events overlapping this bay/date
    await restoreEventHolds(supabase, org.id, [bayId], [date], org.timezone);

    revalidatePath("/admin/schedule/day");
    redirect(`/admin/schedule/day?date=${date}&bay=${bayId}${locParam}`);
  }

  async function removeSlot(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const slotId = formData.get("slot_id") as string;
    const bayId = formData.get("bay_id") as string;
    const date = formData.get("date") as string;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";

    await supabase.from("bay_schedule_slots").delete().eq("id", slotId);

    revalidatePath("/admin/schedule/day");
    redirect(`/admin/schedule/day?date=${date}&bay=${bayId}${locParam}`);
  }

  async function updateSlot(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const slotId = formData.get("slot_id") as string;
    const bayId = formData.get("bay_id") as string;
    const date = formData.get("date") as string;
    const price = parseFloat(formData.get("price") as string) || 0;
    const status = formData.get("status") as string;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";

    const { error } = await supabase
      .from("bay_schedule_slots")
      .update({ price_cents: Math.round(price * 100), status })
      .eq("id", slotId);

    if (error) {
      redirect(
        `/admin/schedule/day?date=${date}&bay=${bayId}&error=${encodeURIComponent(error.message)}${locParam}`
      );
    }

    revalidatePath("/admin/schedule/day");
    redirect(`/admin/schedule/day?date=${date}&bay=${bayId}&saved=true${locParam}`);
  }

  async function clearDaySchedule(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const scheduleId = formData.get("schedule_id") as string;
    const bayId = formData.get("bay_id") as string;
    const date = formData.get("date") as string;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";

    await supabase.from("bay_schedules").delete().eq("id", scheduleId);

    revalidatePath("/admin/schedule/day");
    redirect(`/admin/schedule/day?date=${date}&bay=${bayId}${locParam}`);
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb + header */}
      <div>
        <Link
          href={`/admin/schedule?date=${date}${locationId ? `&location=${locationId}` : ""}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Week View
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-800">
          {formatDateHeading(date)}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Edit schedules for each facility on this day.
        </p>
      </div>

      {/* Alerts */}
      {params.error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <XCircle className="h-5 w-5 shrink-0 text-red-500" />
          {params.error}
        </div>
      )}
      {params.saved && (
        <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
          Changes saved.
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <Layers className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Slots</p>
              <p className="text-xl font-bold text-gray-800">{allSlots.length}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Available</p>
              <p className="text-xl font-bold text-gray-800">{availableCount}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50">
              <Clock className="h-5 w-5 text-indigo-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Booked</p>
              <p className="text-xl font-bold text-gray-800">{bookedCount}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100">
              <Ban className="h-5 w-5 text-gray-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Blocked</p>
              <p className="text-xl font-bold text-gray-800">{blockedCount}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50">
              <CalendarDays className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Event Holds</p>
              <p className="text-xl font-bold text-gray-800">{eventHoldCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Day navigation */}
      <div className="flex items-center justify-between">
        <a
          href={`/admin/schedule/day?date=${prevDate.toISOString().split("T")[0]}${focusedBayId ? `&bay=${focusedBayId}` : ""}${locationId ? `&location=${locationId}` : ""}`}
        >
          <Button variant="outline" size="sm" className="gap-1.5 rounded-lg border-gray-200">
            <ChevronLeft className="h-4 w-4" />
            {formatShortDate(prevDate.toISOString().split("T")[0])}
          </Button>
        </a>
        <form className="flex items-center gap-2">
          <Input
            name="date"
            type="date"
            defaultValue={date}
            className="h-9 w-40 rounded-lg border-gray-200"
          />
          {focusedBayId && (
            <input type="hidden" name="bay" value={focusedBayId} />
          )}
          {locationId && (
            <input type="hidden" name="location" value={locationId} />
          )}
          <Button type="submit" variant="outline" size="sm" className="rounded-lg border-gray-200">
            Go
          </Button>
        </form>
        <a
          href={`/admin/schedule/day?date=${nextDate.toISOString().split("T")[0]}${focusedBayId ? `&bay=${focusedBayId}` : ""}${locationId ? `&location=${locationId}` : ""}`}
        >
          <Button variant="outline" size="sm" className="gap-1.5 rounded-lg border-gray-200">
            {formatShortDate(nextDate.toISOString().split("T")[0])}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </a>
      </div>

      {/* Bay schedule cards */}
      {bays.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white p-12 text-center">
          <Layers className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-500">No active facilities</p>
        </div>
      ) : (
        <div className="space-y-4">
          {bays.map((bay) => {
            const schedule = scheduleByBay.get(bay.id);
            const slots = schedule?.bay_schedule_slots || [];
            const sortedSlots = [...slots].sort((a, b) =>
              a.start_time.localeCompare(b.start_time)
            );
            const isFocused = focusedBayId === bay.id;
            const templateName = schedule
              ? (schedule as { schedule_templates: { name: string } | null }).schedule_templates?.name
              : null;

            return (
              <div
                key={bay.id}
                id={`bay-${bay.id}`}
                className={`rounded-2xl border bg-white ${
                  isFocused
                    ? "border-blue-300 ring-2 ring-blue-100"
                    : "border-gray-200"
                }`}
              >
                {/* Bay header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-6 py-4">
                  <div>
                    <h3 className="font-semibold text-gray-800">{bay.name}</h3>
                    <p className="mt-0.5 text-sm text-gray-500">
                      {schedule
                        ? `${sortedSlots.length} slots${templateName ? ` · Template: ${templateName}` : " · Custom"}`
                        : "No schedule set for this day"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {templates.length > 0 && (
                      <form
                        action={applyTemplateToDay}
                        className="flex items-center gap-2"
                      >
                        <input type="hidden" name="bay_id" value={bay.id} />
                        <input type="hidden" name="date" value={date} />
                        {locationId && <input type="hidden" name="location" value={locationId} />}
                        <select
                          name="template_id"
                          required
                          className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-700 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300"
                        >
                          <option value="">Template...</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" variant="outline" size="sm" className="rounded-lg border-gray-200">
                          Apply
                        </Button>
                      </form>
                    )}
                    {schedule && (
                      <form action={clearDaySchedule}>
                        <input type="hidden" name="schedule_id" value={schedule.id} />
                        <input type="hidden" name="bay_id" value={bay.id} />
                        <input type="hidden" name="date" value={date} />
                        {locationId && <input type="hidden" name="location" value={locationId} />}
                        <Button
                          type="submit"
                          variant="outline"
                          size="sm"
                          className="rounded-lg border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                        >
                          Clear All
                        </Button>
                      </form>
                    )}
                  </div>
                </div>

                {/* Slot list */}
                <div className="p-4">
                  {sortedSlots.length === 0 ? (
                    <div className="rounded-xl border-2 border-dashed border-gray-200 py-8 text-center">
                      <Clock className="mx-auto h-8 w-8 text-gray-300" />
                      <p className="mt-2 text-sm text-gray-500">
                        No slots. Apply a template or add slots manually.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                              Time
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                              Price
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                              Status
                            </th>
                            <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {sortedSlots.map((slot) => {
                            const colors = STATUS_COLORS[slot.status] || STATUS_COLORS.available;
                            return (
                              <tr key={slot.id} className="transition-colors hover:bg-gray-50">
                                <td className="px-4 py-3">
                                  <span className="font-mono text-sm text-gray-800">
                                    {formatTimeInZone(slot.start_time, org.timezone)} –{" "}
                                    {formatTimeInZone(slot.end_time, org.timezone)}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-sm text-gray-700">
                                    ${(slot.price_cents / 100).toFixed(2)}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                                    {slot.status}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  {slot.status === "event_hold" || slot.status === "booked" ? (
                                    <div className="flex items-center justify-end">
                                      <span className="text-xs text-gray-400 italic">
                                        {slot.status === "event_hold" ? "Managed by event" : "Booked"}
                                      </span>
                                    </div>
                                  ) : (
                                  <div className="flex items-center justify-end gap-2">
                                    <form
                                      action={updateSlot}
                                      className="flex items-center gap-1.5"
                                    >
                                      <input type="hidden" name="slot_id" value={slot.id} />
                                      <input type="hidden" name="bay_id" value={bay.id} />
                                      <input type="hidden" name="date" value={date} />
                                      {locationId && <input type="hidden" name="location" value={locationId} />}
                                      <Input
                                        name="price"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        defaultValue={(slot.price_cents / 100).toFixed(2)}
                                        className="h-8 w-20 rounded-lg border-gray-200 text-xs"
                                      />
                                      <select
                                        name="status"
                                        defaultValue={slot.status}
                                        className="h-8 rounded-lg border border-gray-200 bg-white px-1.5 text-xs text-gray-700"
                                      >
                                        <option value="available">available</option>
                                        <option value="blocked">blocked</option>
                                      </select>
                                      <Button
                                        type="submit"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 rounded-lg border-gray-200 text-xs"
                                      >
                                        Save
                                      </Button>
                                    </form>
                                    <form action={removeSlot}>
                                      <input type="hidden" name="slot_id" value={slot.id} />
                                      <input type="hidden" name="bay_id" value={bay.id} />
                                      <input type="hidden" name="date" value={date} />
                                      {locationId && <input type="hidden" name="location" value={locationId} />}
                                      <Button
                                        type="submit"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 rounded-lg border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </form>
                                  </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Add slot form */}
                  <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
                    <form
                      action={addSlot}
                      className="flex flex-wrap items-end gap-3"
                    >
                      <input type="hidden" name="bay_id" value={bay.id} />
                      <input type="hidden" name="date" value={date} />
                      {locationId && <input type="hidden" name="location" value={locationId} />}
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-600">Start</Label>
                        <Input
                          name="start_time"
                          type="time"
                          required
                          className="h-9 w-32 rounded-lg border-gray-200"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-600">End</Label>
                        <Input
                          name="end_time"
                          type="time"
                          required
                          className="h-9 w-32 rounded-lg border-gray-200"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-600">Price ($)</Label>
                        <Input
                          name="price"
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue="0"
                          className="h-9 w-24 rounded-lg border-gray-200"
                        />
                      </div>
                      <Button type="submit" size="sm" className="h-9 gap-1.5 rounded-lg">
                        <Plus className="h-4 w-4" />
                        Add Slot
                      </Button>
                    </form>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
