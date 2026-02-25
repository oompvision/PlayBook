import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toTimestamp, getTodayInTimezone } from "@/lib/utils";
import { SubmitButton } from "@/components/submit-button";
import {
  CalendarDays,
  Layers,
  CheckCircle2,
  LayoutTemplate,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

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

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatWeekday(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function formatDayNum(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.getDate();
}

function formatMonthRange(start: string, end: string) {
  const s = new Date(start + "T12:00:00");
  const e = new Date(end + "T12:00:00");
  const sMonth = s.toLocaleDateString("en-US", { month: "long" });
  const eMonth = e.toLocaleDateString("en-US", { month: "long" });
  const year = s.getFullYear();
  if (sMonth === eMonth) {
    return `${sMonth} ${s.getDate()} – ${e.getDate()}, ${year}`;
  }
  return `${sMonth} ${s.getDate()} – ${eMonth} ${e.getDate()}, ${year}`;
}

export default async function ScheduleManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();

  // Default to today (in the facility's timezone)
  const today = getTodayInTimezone(org.timezone);
  const selectedDate = params.date || today;

  // Get a week of dates starting from selected date
  const weekDates: string[] = [];
  const startDate = new Date(selectedDate + "T12:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    weekDates.push(d.toISOString().split("T")[0]);
  }

  // Get bays, templates, and schedules for this week
  const [baysResult, templatesResult, schedulesResult] = await Promise.all([
    supabase
      .from("bays")
      .select("id, name, is_active, sort_order, hourly_rate_cents")
      .eq("org_id", org.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("schedule_templates")
      .select("id, name, template_slots(count)")
      .eq("org_id", org.id)
      .order("name"),
    supabase
      .from("bay_schedules")
      .select("*, schedule_templates(name)")
      .eq("org_id", org.id)
      .gte("date", weekDates[0])
      .lte("date", weekDates[6]),
  ]);

  const bays = baysResult.data || [];
  const templates = templatesResult.data || [];
  const schedules = schedulesResult.data || [];

  // Build lookup: bay_id + date → schedule
  const scheduleMap = new Map<string, (typeof schedules)[number]>();
  for (const s of schedules) {
    scheduleMap.set(`${s.bay_id}_${s.date}`, s);
  }

  // Get slot counts for displayed schedules
  const scheduleIds = schedules.map((s) => s.id);
  const slotCountMap = new Map<string, number>();
  if (scheduleIds.length > 0) {
    const { data: slotCounts } = await supabase
      .from("bay_schedule_slots")
      .select("bay_schedule_id")
      .in("bay_schedule_id", scheduleIds);
    if (slotCounts) {
      for (const s of slotCounts) {
        slotCountMap.set(
          s.bay_schedule_id,
          (slotCountMap.get(s.bay_schedule_id) || 0) + 1
        );
      }
    }
  }

  // Compute metrics
  const totalSlots = Array.from(slotCountMap.values()).reduce((a, b) => a + b, 0);
  const publishedDays = new Set(schedules.map((s) => s.date)).size;
  const coveredBays = new Set(schedules.map((s) => s.bay_id)).size;
  const templatesUsed = new Set(schedules.filter((s) => s.template_id).map((s) => s.template_id)).size;

  // Previous / next week navigation
  const prevDate = new Date(startDate);
  prevDate.setDate(prevDate.getDate() - 7);
  const nextDate = new Date(startDate);
  nextDate.setDate(nextDate.getDate() + 7);

  async function applyTemplate(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();

    const templateId = formData.get("template_id") as string;
    const bayIds = formData.getAll("bay_ids") as string[];
    const startDateStr = formData.get("start_date") as string;
    const endDateStr = formData.get("end_date") as string;
    const returnDate = formData.get("return_date") as string;

    if (!templateId || bayIds.length === 0 || !startDateStr || !endDateStr) {
      redirect(
        `/admin/schedule?date=${returnDate}&error=${encodeURIComponent("Please fill in all fields")}`
      );
    }

    // Get template slots
    const { data: templateSlots } = await supabase
      .from("template_slots")
      .select("*")
      .eq("template_id", templateId);

    if (!templateSlots || templateSlots.length === 0) {
      redirect(
        `/admin/schedule?date=${returnDate}&error=${encodeURIComponent("Template has no slots")}`
      );
    }

    // Generate dates in range
    const dates: string[] = [];
    const current = new Date(startDateStr + "T12:00:00");
    const end = new Date(endDateStr + "T12:00:00");
    while (current <= end) {
      dates.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 1);
    }

    // Fetch bay hourly rates for price calculation
    const { data: bayData } = await supabase
      .from("bays")
      .select("id, hourly_rate_cents")
      .in("id", bayIds);

    const bayRateMap = new Map<string, number>();
    if (bayData) {
      for (const b of bayData) {
        bayRateMap.set(b.id, b.hourly_rate_cents);
      }
    }

    // For each bay + date, create bay_schedule and bay_schedule_slots
    for (const bayId of bayIds) {
      const hourlyRateCents = bayRateMap.get(bayId) || 0;

      for (const date of dates) {
        // Upsert bay_schedule
        const { data: schedule, error: schedError } = await supabase
          .from("bay_schedules")
          .upsert(
            {
              bay_id: bayId,
              org_id: org.id,
              date,
              template_id: templateId,
            },
            { onConflict: "bay_id,date" }
          )
          .select("id")
          .single();

        if (schedError || !schedule) continue;

        // Delete existing slots for this schedule
        await supabase
          .from("bay_schedule_slots")
          .delete()
          .eq("bay_schedule_id", schedule.id);

        // Create concrete slots from template (timezone-aware)
        // Price is pro-rated from the bay's hourly rate based on slot duration
        const concreteSlots = templateSlots.map((ts) => {
          const [startH, startM] = ts.start_time.split(":").map(Number);
          const [endH, endM] = ts.end_time.split(":").map(Number);
          const durationMinutes = (endH * 60 + endM) - (startH * 60 + startM);
          const priceCents = Math.round(hourlyRateCents * (durationMinutes / 60));

          return {
            bay_schedule_id: schedule.id,
            org_id: org.id,
            start_time: toTimestamp(date, ts.start_time, org.timezone),
            end_time: toTimestamp(date, ts.end_time, org.timezone),
            price_cents: priceCents,
            status: "available" as const,
          };
        });

        await supabase.from("bay_schedule_slots").insert(concreteSlots);
      }
    }

    revalidatePath("/admin/schedule");
    redirect(`/admin/schedule?date=${returnDate}&saved=true`);
  }

  async function clearSchedule(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const scheduleId = formData.get("schedule_id") as string;
    const returnDate = formData.get("return_date") as string;

    await supabase.from("bay_schedules").delete().eq("id", scheduleId);

    revalidatePath("/admin/schedule");
    redirect(`/admin/schedule?date=${returnDate}`);
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Schedule</h1>
        <p className="mt-1 text-sm text-gray-500">
          Apply templates to facilities and manage daily schedules.
        </p>
      </div>

      {/* Alerts */}
      {params.error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100">
            <span className="text-red-500">!</span>
          </div>
          {params.error}
        </div>
      )}
      {params.saved && (
        <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
          Schedule updated successfully.
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <Layers className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Slots</p>
              <p className="text-xl font-bold text-gray-800">{totalSlots}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50">
              <CalendarDays className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Published Days</p>
              <p className="text-xl font-bold text-gray-800">{publishedDays}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50">
              <CheckCircle2 className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Facilities Covered</p>
              <p className="text-xl font-bold text-gray-800">
                {coveredBays}/{bays.length}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50">
              <LayoutTemplate className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Templates Used</p>
              <p className="text-xl font-bold text-gray-800">{templatesUsed}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Apply template card */}
      <div className="rounded-2xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="font-semibold text-gray-800">Apply Template</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Apply a schedule template to one or more facilities for a date range.
          </p>
        </div>
        <div className="p-6">
          {templates.length === 0 ? (
            <p className="text-sm text-gray-500">
              No templates yet.{" "}
              <a href="/admin/templates" className="font-medium text-blue-600 hover:underline">
                Create one first.
              </a>
            </p>
          ) : bays.length === 0 ? (
            <p className="text-sm text-gray-500">
              No active facilities.{" "}
              <a href="/admin/bays" className="font-medium text-blue-600 hover:underline">
                Add facilities first.
              </a>
            </p>
          ) : (
            <form action={applyTemplate} className="space-y-4">
              <input type="hidden" name="return_date" value={selectedDate} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="template_id" className="text-sm text-gray-700">
                    Template
                  </Label>
                  <select
                    id="template_id"
                    name="template_id"
                    required
                    className="flex h-10 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300"
                  >
                    <option value="">Select template...</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="start_date" className="text-sm text-gray-700">
                    Start Date
                  </Label>
                  <Input
                    id="start_date"
                    name="start_date"
                    type="date"
                    defaultValue={today}
                    required
                    className="h-10 rounded-lg border-gray-200"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end_date" className="text-sm text-gray-700">
                    End Date
                  </Label>
                  <Input
                    id="end_date"
                    name="end_date"
                    type="date"
                    defaultValue={weekDates[6]}
                    required
                    className="h-10 rounded-lg border-gray-200"
                  />
                </div>
                <div className="flex items-end">
                  <SubmitButton pendingText="Applying..." className="h-10 w-full rounded-lg">
                    Apply
                  </SubmitButton>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-gray-700">Facilities</Label>
                <div className="flex flex-wrap gap-2">
                  {bays.map((bay) => (
                    <label
                      key={bay.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-100"
                    >
                      <input
                        type="checkbox"
                        name="bay_ids"
                        value={bay.id}
                        defaultChecked
                        className="rounded"
                      />
                      {bay.name}
                    </label>
                  ))}
                </div>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <a href={`/admin/schedule?date=${prevDate.toISOString().split("T")[0]}`}>
          <Button variant="outline" size="sm" className="gap-1.5 rounded-lg border-gray-200">
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
        </a>
        <h2 className="text-sm font-semibold text-gray-800">
          {formatMonthRange(weekDates[0], weekDates[6])}
        </h2>
        <a href={`/admin/schedule?date=${nextDate.toISOString().split("T")[0]}`}>
          <Button variant="outline" size="sm" className="gap-1.5 rounded-lg border-gray-200">
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </a>
      </div>

      {/* Weekly schedule card grid */}
      {bays.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white p-12 text-center">
          <CalendarDays className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-500">No active facilities</p>
          <p className="mt-1 text-sm text-gray-400">
            Add facilities first to manage schedules.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {weekDates.map((date) => {
            const isToday = date === today;
            return (
              <div
                key={date}
                className={`rounded-2xl border bg-white ${
                  isToday
                    ? "border-blue-300 ring-1 ring-blue-100"
                    : "border-gray-200"
                }`}
              >
                {/* Day header */}
                <a
                  href={`/admin/schedule/day?date=${date}`}
                  className="block border-b border-gray-100 px-4 py-3 transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-medium uppercase tracking-wide ${isToday ? "text-blue-600" : "text-gray-400"}`}>
                      {formatWeekday(date)}
                    </span>
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                        isToday
                          ? "bg-blue-600 text-white"
                          : "text-gray-800"
                      }`}
                    >
                      {formatDayNum(date)}
                    </span>
                  </div>
                </a>

                {/* Bay slots for this day */}
                <div className="divide-y divide-gray-100 px-3 py-2">
                  {bays.map((bay) => {
                    const schedule = scheduleMap.get(`${bay.id}_${date}`);
                    const slotCount = schedule
                      ? slotCountMap.get(schedule.id) || 0
                      : 0;
                    const templateName = schedule
                      ? (schedule as { schedule_templates: { name: string } | null }).schedule_templates?.name
                      : null;

                    return (
                      <a
                        key={bay.id}
                        href={`/admin/schedule/day?date=${date}&bay=${bay.id}`}
                        className="flex items-center justify-between py-2 transition-colors hover:bg-gray-50 rounded px-1 -mx-1"
                      >
                        <span className="truncate text-xs font-medium text-gray-700">
                          {bay.name}
                        </span>
                        {schedule ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-gray-400">
                              {slotCount}s
                            </span>
                            <span className="inline-flex h-2 w-2 rounded-full bg-green-400" />
                          </div>
                        ) : (
                          <span className="inline-flex h-2 w-2 rounded-full bg-gray-200" />
                        )}
                      </a>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
