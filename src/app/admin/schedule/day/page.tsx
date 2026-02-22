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

const STATUS_STYLES: Record<string, string> = {
  available: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  booked: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  blocked: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

export default async function DayEditorPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    bay?: string;
    error?: string;
    saved?: string;
  }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const today = getTodayInTimezone(org.timezone);
  const date = params.date || today;

  // Get bays and templates
  const [baysResult, templatesResult] = await Promise.all([
    supabase
      .from("bays")
      .select("id, name, is_active, sort_order")
      .eq("org_id", org.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("schedule_templates")
      .select("id, name")
      .eq("org_id", org.id)
      .order("name"),
  ]);

  const bays = baysResult.data || [];
  const templates = templatesResult.data || [];

  // Get schedules + slots for this date
  const { data: schedules } = await supabase
    .from("bay_schedules")
    .select("*, schedule_templates(name), bay_schedule_slots(*)")
    .eq("org_id", org.id)
    .eq("date", date);

  // Build lookup: bay_id → schedule with slots
  const scheduleByBay = new Map<string, (typeof schedules extends (infer T)[] | null ? T : never)>();
  if (schedules) {
    for (const s of schedules) {
      scheduleByBay.set(s.bay_id, s);
    }
  }

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

    const { data: templateSlots } = await supabase
      .from("template_slots")
      .select("*")
      .eq("template_id", templateId);

    if (!templateSlots || templateSlots.length === 0) {
      redirect(
        `/admin/schedule/day?date=${date}&bay=${bayId}&error=${encodeURIComponent("Template has no slots")}`
      );
    }

    // Upsert bay_schedule
    const { data: schedule, error: schedError } = await supabase
      .from("bay_schedules")
      .upsert(
        { bay_id: bayId, org_id: org.id, date, template_id: templateId },
        { onConflict: "bay_id,date" }
      )
      .select("id")
      .single();

    if (schedError || !schedule) {
      redirect(
        `/admin/schedule/day?date=${date}&bay=${bayId}&error=${encodeURIComponent(schedError?.message || "Failed to create schedule")}`
      );
    }

    // Delete old slots
    await supabase
      .from("bay_schedule_slots")
      .delete()
      .eq("bay_schedule_id", schedule.id);

    // Insert new (timezone-aware)
    const concreteSlots = templateSlots.map((ts) => ({
      bay_schedule_id: schedule.id,
      org_id: org.id,
      start_time: toTimestamp(date, ts.start_time, org.timezone),
      end_time: toTimestamp(date, ts.end_time, org.timezone),
      price_cents: ts.price_cents || 0,
      status: "available" as const,
    }));

    await supabase.from("bay_schedule_slots").insert(concreteSlots);

    revalidatePath("/admin/schedule/day");
    redirect(`/admin/schedule/day?date=${date}&bay=${bayId}&saved=true`);
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
        .insert({ bay_id: bayId, org_id: org.id, date })
        .select("id")
        .single();
      schedule = newSchedule;
    }

    if (!schedule) {
      redirect(
        `/admin/schedule/day?date=${date}&bay=${bayId}&error=${encodeURIComponent("Failed to create schedule")}`
      );
    }

    const { error } = await supabase.from("bay_schedule_slots").insert({
      bay_schedule_id: schedule.id,
      org_id: org.id,
      start_time: toTimestamp(date, startTime, org.timezone),
      end_time: toTimestamp(date, endTime, org.timezone),
      price_cents: Math.round(price * 100),
      status: "available",
    });

    if (error) {
      redirect(
        `/admin/schedule/day?date=${date}&bay=${bayId}&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/admin/schedule/day");
    redirect(`/admin/schedule/day?date=${date}&bay=${bayId}`);
  }

  async function removeSlot(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const slotId = formData.get("slot_id") as string;
    const bayId = formData.get("bay_id") as string;
    const date = formData.get("date") as string;

    await supabase.from("bay_schedule_slots").delete().eq("id", slotId);

    revalidatePath("/admin/schedule/day");
    redirect(`/admin/schedule/day?date=${date}&bay=${bayId}`);
  }

  async function updateSlot(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const slotId = formData.get("slot_id") as string;
    const bayId = formData.get("bay_id") as string;
    const date = formData.get("date") as string;
    const price = parseFloat(formData.get("price") as string) || 0;
    const status = formData.get("status") as string;

    const { error } = await supabase
      .from("bay_schedule_slots")
      .update({ price_cents: Math.round(price * 100), status })
      .eq("id", slotId);

    if (error) {
      redirect(
        `/admin/schedule/day?date=${date}&bay=${bayId}&error=${encodeURIComponent(error.message)}`
      );
    }

    revalidatePath("/admin/schedule/day");
    redirect(`/admin/schedule/day?date=${date}&bay=${bayId}&saved=true`);
  }

  async function clearDaySchedule(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const scheduleId = formData.get("schedule_id") as string;
    const bayId = formData.get("bay_id") as string;
    const date = formData.get("date") as string;

    await supabase.from("bay_schedules").delete().eq("id", scheduleId);

    revalidatePath("/admin/schedule/day");
    redirect(`/admin/schedule/day?date=${date}&bay=${bayId}`);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/admin/schedule?date=${date}`}>
          <Button variant="outline" size="sm">
            &larr; Week View
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {formatDateHeading(date)}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Edit schedules for each bay on this day.
          </p>
        </div>
      </div>

      {params.error && (
        <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {params.error}
        </div>
      )}
      {params.saved && (
        <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          Changes saved.
        </div>
      )}

      {/* Day navigation */}
      <div className="mt-6 flex items-center justify-between">
        <a
          href={`/admin/schedule/day?date=${prevDate.toISOString().split("T")[0]}${focusedBayId ? `&bay=${focusedBayId}` : ""}`}
        >
          <Button variant="outline" size="sm">
            Previous Day
          </Button>
        </a>
        <div className="flex items-center gap-2">
          <form className="flex items-center gap-2">
            <Input
              name="date"
              type="date"
              defaultValue={date}
              className="w-40"
            />
            {focusedBayId && (
              <input type="hidden" name="bay" value={focusedBayId} />
            )}
            <Button type="submit" variant="outline" size="sm">
              Go
            </Button>
          </form>
        </div>
        <a
          href={`/admin/schedule/day?date=${nextDate.toISOString().split("T")[0]}${focusedBayId ? `&bay=${focusedBayId}` : ""}`}
        >
          <Button variant="outline" size="sm">
            Next Day
          </Button>
        </a>
      </div>

      {/* Bay schedule cards */}
      <div className="mt-6 space-y-6">
        {bays.length === 0 && (
          <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            No active bays.
          </div>
        )}

        {bays.map((bay, index) => {
          const schedule = scheduleByBay.get(bay.id);
          const slots = schedule?.bay_schedule_slots || [];
          const sortedSlots = [...slots].sort((a, b) =>
            a.start_time.localeCompare(b.start_time)
          );
          const isFocused = focusedBayId === bay.id;
          const isOpen = isFocused || (!focusedBayId && index === 0);

          return (
            <details
              key={bay.id}
              id={`bay-${bay.id}`}
              open={isOpen || undefined}
              className={`group rounded-lg border ${isFocused ? "ring-2 ring-primary" : ""}`}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 [&::-webkit-details-marker]:hidden">
                <div className="flex items-center gap-3">
                  <svg
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  <div>
                    <p className="font-semibold leading-none tracking-tight">
                      {bay.name}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {schedule
                        ? `${sortedSlots.length} slots · Template: ${(schedule as { schedule_templates: { name: string } | null }).schedule_templates?.name || "Custom"}`
                        : "No schedule set for this day"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {templates.length > 0 && (
                    <form
                      action={applyTemplateToDay}
                      className="flex items-center gap-2"
                    >
                      <input type="hidden" name="bay_id" value={bay.id} />
                      <input type="hidden" name="date" value={date} />
                      <select
                        name="template_id"
                        required
                        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="">Template...</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" variant="outline" size="sm">
                        Apply
                      </Button>
                    </form>
                  )}
                  {schedule && (
                    <form action={clearDaySchedule}>
                      <input
                        type="hidden"
                        name="schedule_id"
                        value={schedule.id}
                      />
                      <input type="hidden" name="bay_id" value={bay.id} />
                      <input type="hidden" name="date" value={date} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                      >
                        Clear All
                      </Button>
                    </form>
                  )}
                </div>
              </summary>
              <div className="border-t px-6 py-4">
                {/* Slot list */}
                {sortedSlots.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No slots. Apply a template or add slots manually below.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {sortedSlots.map((slot) => (
                      <div
                        key={slot.id}
                        className="flex items-center justify-between rounded-md border px-3 py-2"
                      >
                        <div className="flex items-center gap-4">
                          <span className="font-mono text-sm">
                            {formatTimeInZone(slot.start_time, org.timezone)} –{" "}
                            {formatTimeInZone(slot.end_time, org.timezone)}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            ${(slot.price_cents / 100).toFixed(2)}
                          </span>
                          <Badge
                            variant="secondary"
                            className={`text-xs ${STATUS_STYLES[slot.status] || ""}`}
                          >
                            {slot.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <form
                            action={updateSlot}
                            className="flex items-center gap-2"
                          >
                            <input
                              type="hidden"
                              name="slot_id"
                              value={slot.id}
                            />
                            <input
                              type="hidden"
                              name="bay_id"
                              value={bay.id}
                            />
                            <input
                              type="hidden"
                              name="date"
                              value={date}
                            />
                            <Input
                              name="price"
                              type="number"
                              step="0.01"
                              min="0"
                              defaultValue={(slot.price_cents / 100).toFixed(2)}
                              className="h-7 w-20 text-xs"
                            />
                            <select
                              name="status"
                              defaultValue={slot.status}
                              className="h-7 rounded-md border border-input bg-transparent px-1 text-xs"
                            >
                              <option value="available">available</option>
                              <option value="blocked">blocked</option>
                            </select>
                            <Button
                              type="submit"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                            >
                              Save
                            </Button>
                          </form>
                          {slot.status !== "booked" && (
                            <form action={removeSlot}>
                              <input
                                type="hidden"
                                name="slot_id"
                                value={slot.id}
                              />
                              <input
                                type="hidden"
                                name="bay_id"
                                value={bay.id}
                              />
                              <input
                                type="hidden"
                                name="date"
                                value={date}
                              />
                              <Button
                                type="submit"
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs text-destructive hover:bg-destructive/10"
                              >
                                Remove
                              </Button>
                            </form>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add single slot */}
                <form
                  action={addSlot}
                  className="mt-4 flex items-end gap-3 border-t pt-4"
                >
                  <input type="hidden" name="bay_id" value={bay.id} />
                  <input type="hidden" name="date" value={date} />
                  <div className="space-y-1">
                    <Label className="text-xs">Start</Label>
                    <Input
                      name="start_time"
                      type="time"
                      required
                      className="w-32"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">End</Label>
                    <Input
                      name="end_time"
                      type="time"
                      required
                      className="w-32"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Price ($)</Label>
                    <Input
                      name="price"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue="0"
                      className="w-24"
                    />
                  </div>
                  <Button type="submit" size="sm">
                    Add Slot
                  </Button>
                </form>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
