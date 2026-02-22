import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

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

export default async function ScheduleManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();

  // Default to today
  const today = new Date().toISOString().split("T")[0];
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
      .select("id, name, is_active, sort_order")
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

    // For each bay + date, create bay_schedule and bay_schedule_slots
    for (const bayId of bayIds) {
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

        // Create concrete slots from template
        const concreteSlots = templateSlots.map((ts) => ({
          bay_schedule_id: schedule.id,
          org_id: org.id,
          start_time: `${date}T${ts.start_time}`,
          end_time: `${date}T${ts.end_time}`,
          price_cents: ts.price_cents || 0,
          status: "available" as const,
        }));

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
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Schedule</h1>
          <p className="mt-2 text-muted-foreground">
            Apply templates to bays and manage daily schedules.
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
          Schedule updated successfully.
        </div>
      )}

      {/* Apply template form */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Apply Template</CardTitle>
          <CardDescription>
            Apply a schedule template to one or more bays for a date range.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No templates yet.{" "}
              <a href="/admin/templates" className="text-primary hover:underline">
                Create one first.
              </a>
            </p>
          ) : bays.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active bays.{" "}
              <a href="/admin/bays" className="text-primary hover:underline">
                Add bays first.
              </a>
            </p>
          ) : (
            <form action={applyTemplate} className="space-y-4">
              <input
                type="hidden"
                name="return_date"
                value={selectedDate}
              />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="template_id">Template</Label>
                  <select
                    id="template_id"
                    name="template_id"
                    required
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select template...</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="start_date">Start Date</Label>
                  <Input
                    id="start_date"
                    name="start_date"
                    type="date"
                    defaultValue={today}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end_date">End Date</Label>
                  <Input
                    id="end_date"
                    name="end_date"
                    type="date"
                    defaultValue={weekDates[6]}
                    required
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" className="w-full">
                    Apply
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Bays</Label>
                <div className="flex flex-wrap gap-3">
                  {bays.map((bay) => (
                    <label
                      key={bay.id}
                      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent cursor-pointer"
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
        </CardContent>
      </Card>

      {/* Week navigation */}
      <div className="mt-8 flex items-center justify-between">
        <a href={`/admin/schedule?date=${prevDate.toISOString().split("T")[0]}`}>
          <Button variant="outline" size="sm">
            Previous Week
          </Button>
        </a>
        <h2 className="text-sm font-medium">
          {formatDate(weekDates[0])} – {formatDate(weekDates[6])}
        </h2>
        <a href={`/admin/schedule?date=${nextDate.toISOString().split("T")[0]}`}>
          <Button variant="outline" size="sm">
            Next Week
          </Button>
        </a>
      </div>

      {/* Weekly schedule grid */}
      {bays.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          No active bays. Add bays first to manage schedules.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left text-sm font-medium text-muted-foreground">
                  Bay
                </th>
                {weekDates.map((date) => (
                  <th
                    key={date}
                    className={`border p-0 text-center text-sm font-medium ${
                      date === today
                        ? "bg-primary/5 text-primary"
                        : "text-muted-foreground"
                    }`}
                  >
                    <a
                      href={`/admin/schedule/day?date=${date}`}
                      className="block p-2 hover:bg-accent/50 transition-colors"
                    >
                      {formatDate(date)}
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bays.map((bay) => (
                <tr key={bay.id}>
                  <td className="border p-2 text-sm font-medium">
                    {bay.name}
                  </td>
                  {weekDates.map((date) => {
                    const schedule = scheduleMap.get(`${bay.id}_${date}`);
                    return (
                      <td
                        key={date}
                        className={`border p-0 text-center ${
                          date === today ? "bg-primary/5" : ""
                        }`}
                      >
                        <a
                          href={`/admin/schedule/day?date=${date}&bay=${bay.id}`}
                          className="block p-2 hover:bg-accent/50 transition-colors"
                        >
                          {schedule ? (
                            <div className="space-y-1">
                              <Badge variant="default" className="text-xs">
                                {(schedule as { schedule_templates: { name: string } | null }).schedule_templates?.name || "Custom"}
                              </Badge>
                              <p className="text-xs text-muted-foreground">
                                {slotCountMap.get(schedule.id) || 0} slots
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </a>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
