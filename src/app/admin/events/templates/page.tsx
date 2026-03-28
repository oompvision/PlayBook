import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { resolveLocationId } from "@/lib/location";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  LayoutTemplate,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  CalendarClock,
  Clock,
} from "lucide-react";
import { SavedToast } from "@/components/admin/saved-toast";

const TEMPLATE_COLORS = [
  "#3B82F6", // blue
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#06B6D4", // cyan
  "#F97316", // orange
  "#14B8A6", // teal
  "#6366F1", // indigo
];

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

export default async function EventTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    edit?: string;
    editSchedule?: string;
    location?: string;
    tab?: string;
  }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const locationId = await resolveLocationId(org.id, params.location);

  const [templatesResult, baysResult] = await Promise.all([
    supabase
      .from("event_templates")
      .select("*")
      .eq("org_id", org.id)
      .order("created_at", { ascending: false }),
    (() => {
      const q = supabase
        .from("bays")
        .select("id, name")
        .eq("org_id", org.id)
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (locationId) q.eq("location_id", locationId);
      return q;
    })(),
  ]);

  const templates = templatesResult.data;
  const bays = baysResult.data || [];

  // Fetch day schedules with entries
  const { data: daySchedulesRaw } = await supabase
    .from("event_day_schedules")
    .select("id, name, created_at, event_day_schedule_entries(id, event_template_id, sort_order, start_time, end_time)")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false });

  const daySchedules = (daySchedulesRaw || []).map((ds) => ({
    ...ds,
    entries: (ds.event_day_schedule_entries || [])
      .sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order)
      .map((e: { id: string; event_template_id: string; sort_order: number; start_time: string | null; end_time: string | null }) => ({
        ...e,
        templateName: templates?.find((t) => t.id === e.event_template_id)?.name || "Unknown",
        templateColor: templates?.find((t) => t.id === e.event_template_id)?.config?.color || "#3B82F6",
      })),
  }));

  const editingId = params.edit;
  const editingTemplate = templates?.find((t) => t.id === editingId);
  const editingDayScheduleId = params.editSchedule;
  const editingDaySchedule = daySchedules.find((ds) => ds.id === editingDayScheduleId);

  async function createTemplate(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();

    const name = formData.get("name") as string;
    // Read bay checkboxes directly from formData (bay_XXX fields)
    const bayIds: string[] = [];
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("bay_") && key !== "bay_ids") {
        bayIds.push(value as string);
      }
    }
    const color = (formData.get("color") as string) || TEMPLATE_COLORS[0];
    const config = {
      capacity: parseInt(formData.get("capacity") as string, 10) || 12,
      price_cents: Math.round((parseFloat(formData.get("price") as string) || 0) * 100),
      members_only: formData.has("members_only"),
      member_enrollment_days_before: formData.get("member_enrollment_days_before")
        ? parseInt(formData.get("member_enrollment_days_before") as string, 10)
        : null,
      guest_enrollment_days_before: parseInt(
        formData.get("guest_enrollment_days_before") as string, 10
      ) || 7,
      waitlist_promotion_hours: parseInt(
        formData.get("waitlist_promotion_hours") as string, 10
      ) || 24,
      description: (formData.get("description") as string) || null,
      bay_ids: bayIds,
      color,
    };

    const { error } = await supabase.from("event_templates").insert({
      org_id: org.id,
      name,
      config,
    });

    if (error) {
      redirect(`/admin/events/templates?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/admin/events/templates");
    revalidatePath("/admin/events/calendar");
    redirect("/admin/events/templates?saved=true");
  }

  async function updateTemplate(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    // Read bay checkboxes directly from formData (bay_XXX fields)
    const bayIds: string[] = [];
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("bay_") && key !== "bay_ids") {
        bayIds.push(value as string);
      }
    }
    const color = (formData.get("color") as string) || TEMPLATE_COLORS[0];
    const config = {
      capacity: parseInt(formData.get("capacity") as string, 10) || 12,
      price_cents: Math.round((parseFloat(formData.get("price") as string) || 0) * 100),
      members_only: formData.has("members_only"),
      member_enrollment_days_before: formData.get("member_enrollment_days_before")
        ? parseInt(formData.get("member_enrollment_days_before") as string, 10)
        : null,
      guest_enrollment_days_before: parseInt(
        formData.get("guest_enrollment_days_before") as string, 10
      ) || 7,
      waitlist_promotion_hours: parseInt(
        formData.get("waitlist_promotion_hours") as string, 10
      ) || 24,
      description: (formData.get("description") as string) || null,
      bay_ids: bayIds,
      color,
    };

    const { error } = await supabase
      .from("event_templates")
      .update({ name, config })
      .eq("id", id);

    if (error) {
      redirect(`/admin/events/templates?edit=${id}&error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/admin/events/templates");
    revalidatePath("/admin/events/calendar");
    redirect("/admin/events/templates?saved=true");
  }

  async function deleteTemplate(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    await supabase.from("event_templates").delete().eq("id", id);
    revalidatePath("/admin/events/templates");
    revalidatePath("/admin/events/calendar");
    redirect("/admin/events/templates");
  }

  // ─── Day Schedule Server Actions ───

  async function renameDaySchedule(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    await supabase.from("event_day_schedules").update({ name }).eq("id", id);
    revalidatePath("/admin/events/templates");
    revalidatePath("/admin/events/calendar");
    redirect("/admin/events/templates?tab=schedules&saved=true");
  }

  async function deleteDaySchedule(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    await supabase.from("event_day_schedules").delete().eq("id", id);
    revalidatePath("/admin/events/templates");
    revalidatePath("/admin/events/calendar");
    redirect("/admin/events/templates?tab=schedules");
  }

  async function deleteDayScheduleEntry(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const entryId = formData.get("entry_id") as string;
    await supabase.from("event_day_schedule_entries").delete().eq("id", entryId);
    revalidatePath("/admin/events/templates");
    revalidatePath("/admin/events/calendar");
    redirect(`/admin/events/templates?tab=schedules&editSchedule=${formData.get("schedule_id")}`);
  }

  async function updateDayScheduleEntry(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const entryId = formData.get("entry_id") as string;
    const startTime = formData.get("start_time") as string;
    const endTime = formData.get("end_time") as string;
    await supabase
      .from("event_day_schedule_entries")
      .update({ start_time: startTime, end_time: endTime })
      .eq("id", entryId);
    revalidatePath("/admin/events/templates");
    revalidatePath("/admin/events/calendar");
    redirect(`/admin/events/templates?tab=schedules&editSchedule=${formData.get("schedule_id")}&saved=true`);
  }

  async function addDayScheduleEntry(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const scheduleId = formData.get("schedule_id") as string;
    const templateId = formData.get("template_id") as string;
    const startTime = formData.get("start_time") as string;
    const endTime = formData.get("end_time") as string;

    // Get max sort_order
    const { data: existing } = await supabase
      .from("event_day_schedule_entries")
      .select("sort_order")
      .eq("day_schedule_id", scheduleId)
      .order("sort_order", { ascending: false })
      .limit(1);
    const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

    await supabase.from("event_day_schedule_entries").insert({
      day_schedule_id: scheduleId,
      event_template_id: templateId,
      sort_order: nextOrder,
      start_time: startTime,
      end_time: endTime,
    });
    revalidatePath("/admin/events/templates");
    revalidatePath("/admin/events/calendar");
    redirect(`/admin/events/templates?tab=schedules&editSchedule=${scheduleId}&saved=true`);
  }

  async function createDaySchedule(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();
    const locationId = await resolveLocationId(org.id, null);

    const name = formData.get("name") as string;
    if (!name?.trim()) return;

    // Create the day schedule
    const { data: ds, error: dsError } = await supabase
      .from("event_day_schedules")
      .insert({ org_id: org.id, location_id: locationId, name: name.trim() })
      .select("id")
      .single();

    if (dsError || !ds) {
      redirect(`/admin/events/templates?tab=schedules&error=${encodeURIComponent(dsError?.message || "Failed to create")}`);
      return;
    }

    // Parse entries from form (entry_0_template_id, entry_0_start_time, entry_0_end_time, etc.)
    const entries: { template_id: string; start_time: string; end_time: string }[] = [];
    for (let i = 0; i < 20; i++) {
      const templateId = formData.get(`entry_${i}_template_id`) as string;
      const startTime = formData.get(`entry_${i}_start_time`) as string;
      const endTime = formData.get(`entry_${i}_end_time`) as string;
      if (templateId && startTime && endTime) {
        entries.push({ template_id: templateId, start_time: startTime, end_time: endTime });
      }
    }

    if (entries.length > 0) {
      await supabase.from("event_day_schedule_entries").insert(
        entries.map((e, i) => ({
          day_schedule_id: ds.id,
          event_template_id: e.template_id,
          sort_order: i,
          start_time: e.start_time,
          end_time: e.end_time,
        }))
      );
    }

    revalidatePath("/admin/events/templates");
    revalidatePath("/admin/events/calendar");
    redirect(`/admin/events/templates?tab=schedules&saved=true`);
  }

  const inputClass =
    "h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";
  const labelClass = "text-xs font-medium text-gray-500 dark:text-gray-400";

  function TemplateFormFields({
    defaults,
  }: {
    defaults?: {
      name?: string;
      description?: string;
      capacity?: number;
      price_cents?: number;
      members_only?: boolean;
      guest_enrollment_days_before?: number;
      waitlist_promotion_hours?: number;
      bay_ids?: string[];
      color?: string;
    };
  }) {
    const defaultBayIds = defaults?.bay_ids || [];
    const defaultColor = defaults?.color || TEMPLATE_COLORS[0];

    return (
      <>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <label className={labelClass}>Template Name *</label>
            <input
              name="name"
              required
              defaultValue={defaults?.name || ""}
              placeholder="e.g. Saturday Open Court"
              className={inputClass + " placeholder:text-gray-400 dark:placeholder:text-white/30"}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className={labelClass}>Description</label>
            <input
              name="description"
              defaultValue={defaults?.description || ""}
              placeholder="Optional default description"
              className={inputClass + " placeholder:text-gray-400 dark:placeholder:text-white/30"}
            />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Default Capacity</label>
            <input name="capacity" type="number" min="1" defaultValue={defaults?.capacity || 12} className={inputClass} />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Default Price ($)</label>
            <input name="price" type="number" step="0.01" min="0" defaultValue={((defaults?.price_cents || 0) / 100).toFixed(2)} className={inputClass} />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Guest Enrollment (days before)</label>
            <input name="guest_enrollment_days_before" type="number" min="0" defaultValue={defaults?.guest_enrollment_days_before || 7} className={inputClass} />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Waitlist Window (hours)</label>
            <input name="waitlist_promotion_hours" type="number" min="1" defaultValue={defaults?.waitlist_promotion_hours || 24} className={inputClass} />
          </div>

          {/* Members Only */}
          <div className="sm:col-span-2">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                name="members_only"
                value="true"
                defaultChecked={defaults?.members_only || false}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Members Only</span>
                <p className="text-xs text-gray-400 dark:text-gray-500">Restrict this event to members</p>
              </div>
            </label>
          </div>

          {/* Color Picker */}
          <div className="space-y-1.5 sm:col-span-2">
            <label className={labelClass}>Calendar Color</label>
            <div className="flex flex-wrap gap-2">
              {TEMPLATE_COLORS.map((c) => (
                <label key={c} className="cursor-pointer">
                  <input
                    type="radio"
                    name="color"
                    value={c}
                    defaultChecked={c === defaultColor}
                    className="peer sr-only"
                  />
                  <span
                    className="inline-block h-8 w-8 rounded-full border-2 border-transparent ring-offset-2 transition-all peer-checked:border-gray-800 peer-checked:ring-2 peer-checked:ring-gray-300 dark:peer-checked:border-white dark:peer-checked:ring-gray-600"
                    style={{ backgroundColor: c }}
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Bay Assignments */}
          {bays.length > 0 && (
            <div className="space-y-1.5 sm:col-span-2">
              <label className={labelClass}>Default Facilities</label>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Pre-select which facilities this event uses. Can be changed when applying to dates.
              </p>
              <div className="mt-1 rounded-lg border border-gray-200 dark:border-gray-700">
                {bays.map((bay) => (
                  <label
                    key={bay.id}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <input
                      type="checkbox"
                      name={`bay_${bay.id}`}
                      value={bay.id}
                      defaultChecked={defaultBayIds.includes(bay.id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {bay.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  const activeTab = params.tab === "schedules" || params.editSchedule ? "schedules" : "templates";

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/events"
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
              Templates
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Manage event templates and day schedule templates.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-800">
        <a
          href="/admin/events/templates"
          className={
            activeTab === "templates"
              ? "flex-1 rounded-md bg-white px-4 py-2 text-center text-sm font-medium text-gray-800 shadow-sm dark:bg-gray-700 dark:text-white"
              : "flex-1 rounded-md px-4 py-2 text-center text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          }
        >
          <span className="flex items-center justify-center gap-1.5">
            <LayoutTemplate className="h-4 w-4" />
            Event Templates
          </span>
        </a>
        <a
          href="/admin/events/templates?tab=schedules"
          className={
            activeTab === "schedules"
              ? "flex-1 rounded-md bg-white px-4 py-2 text-center text-sm font-medium text-gray-800 shadow-sm dark:bg-gray-700 dark:text-white"
              : "flex-1 rounded-md px-4 py-2 text-center text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          }
        >
          <span className="flex items-center justify-center gap-1.5">
            <CalendarClock className="h-4 w-4" />
            Day Schedule Templates
          </span>
        </a>
      </div>

      {/* Alerts */}
      {params.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {params.error}
        </div>
      )}
      <SavedToast message="Template saved." />

      {/* ─── Event Templates Tab ─── */}
      {activeTab === "templates" && <>

      {/* Edit form */}
      {editingTemplate && (
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
            <h2 className="font-semibold text-gray-800 dark:text-white/90">
              Edit Template
            </h2>
          </div>
          <div className="p-6">
            <form action={updateTemplate} className="space-y-4">
              <input type="hidden" name="id" value={editingTemplate.id} />
              <TemplateFormFields
                defaults={{
                  name: editingTemplate.name,
                  description: editingTemplate.config?.description,
                  capacity: editingTemplate.config?.capacity,
                  price_cents: editingTemplate.config?.price_cents,
                  members_only: editingTemplate.config?.members_only,
                  guest_enrollment_days_before: editingTemplate.config?.guest_enrollment_days_before,
                  waitlist_promotion_hours: editingTemplate.config?.waitlist_promotion_hours,
                  bay_ids: editingTemplate.config?.bay_ids,
                  color: editingTemplate.config?.color,
                }}
              />
              <div className="flex gap-2">
                <button type="submit" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700">
                  Save Changes
                </button>
                <a href="/admin/events/templates">
                  <button type="button" className="inline-flex h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                    Cancel
                  </button>
                </a>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Templates List */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        {!templates || templates.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <LayoutTemplate className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
              No templates yet
            </p>
            <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
              Create a template below to reuse event configurations.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-white/[0.05]">
            {templates.map((tpl) => (
              <div key={tpl.id} className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: tpl.config?.color || TEMPLATE_COLORS[0] }}
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                      {tpl.name}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {tpl.config?.capacity || "?"} spots ·{" "}
                      {tpl.config?.price_cents
                        ? `$${(tpl.config.price_cents / 100).toFixed(2)}`
                        : "Free"}
                      {tpl.config?.members_only ? " · Members Only" : ""}
                      {tpl.config?.bay_ids?.length
                        ? ` · ${tpl.config.bay_ids.length} ${tpl.config.bay_ids.length === 1 ? "facility" : "facilities"}`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a href={`/admin/events/templates?edit=${tpl.id}`}>
                    <button className="rounded-lg border border-gray-300 bg-white p-2 text-gray-500 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800">
                      <Pencil className="h-4 w-4" />
                    </button>
                  </a>
                  <form action={deleteTemplate}>
                    <input type="hidden" name="id" value={tpl.id} />
                    <button type="submit" className="rounded-lg border border-gray-300 bg-white p-2 text-red-500 shadow-sm transition-colors hover:bg-red-50 dark:border-gray-700 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create New Template */}
      {!editingId && (
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              <h2 className="font-semibold text-gray-800 dark:text-white/90">
                New Template
              </h2>
            </div>
          </div>
          <div className="p-6">
            <form action={createTemplate} className="space-y-4">
              <TemplateFormFields />
              <button type="submit" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700">
                <Plus className="h-4 w-4" />
                Create Template
              </button>
            </form>
          </div>
        </div>
      )}

      </>}

      {/* ─── Day Schedule Templates Tab ─── */}
      {activeTab === "schedules" && <>

      {/* ─── Day Schedules Section ─── */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <h2 className="font-semibold text-gray-800 dark:text-white/90">
              Day Schedules
            </h2>
          </div>
          <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
            Saved day lineups that can be applied to dates from the Event Calendar.
          </p>
        </div>

        {daySchedules.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <CalendarClock className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
              No day schedules yet
            </p>
            <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
              Open a day with events in the Event Calendar and use &ldquo;Save as Day Schedule&rdquo;.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-white/[0.05]">
            {daySchedules.map((ds) => (
              <div key={ds.id}>
                <div className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                      {ds.name}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {ds.entries.length} event{ds.entries.length !== 1 ? "s" : ""}
                      {ds.entries.length > 0 && (
                        <> · {ds.entries.map((e: { templateName: string }) => e.templateName).join(", ")}</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a href={`/admin/events/templates?tab=schedules&editSchedule=${ds.id}`}>
                      <button className="rounded-lg border border-gray-300 bg-white p-2 text-gray-500 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800">
                        <Pencil className="h-4 w-4" />
                      </button>
                    </a>
                    <form action={deleteDaySchedule}>
                      <input type="hidden" name="id" value={ds.id} />
                      <button type="submit" className="rounded-lg border border-gray-300 bg-white p-2 text-red-500 shadow-sm transition-colors hover:bg-red-50 dark:border-gray-700 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </form>
                  </div>
                </div>

                {/* Expanded edit view */}
                {editingDayScheduleId === ds.id && (
                  <div className="border-t border-gray-100 bg-gray-50 px-6 py-4 dark:border-white/[0.05] dark:bg-white/[0.02]">
                    {/* Rename */}
                    <form action={renameDaySchedule} className="mb-4 flex items-end gap-2">
                      <input type="hidden" name="id" value={ds.id} />
                      <div className="flex-1">
                        <label className={labelClass}>Schedule Name</label>
                        <input
                          name="name"
                          defaultValue={ds.name}
                          required
                          className={inputClass + " mt-1"}
                        />
                      </div>
                      <button type="submit" className="inline-flex h-10 items-center rounded-lg bg-blue-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
                        Rename
                      </button>
                    </form>

                    {/* Entries */}
                    <div className="space-y-2">
                      <label className={labelClass}>Events</label>
                      {ds.entries.map((entry: { id: string; event_template_id: string; start_time: string | null; end_time: string | null; templateName: string; templateColor: string }) => (
                        <div key={entry.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                          <span
                            className="inline-block h-3 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: entry.templateColor }}
                          />
                          <span className="min-w-0 flex-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                            {entry.templateName}
                          </span>
                          <form action={updateDayScheduleEntry} className="flex items-center gap-1.5">
                            <input type="hidden" name="entry_id" value={entry.id} />
                            <input type="hidden" name="schedule_id" value={ds.id} />
                            <input
                              name="start_time"
                              type="time"
                              defaultValue={entry.start_time || ""}
                              required
                              className="h-8 w-24 rounded border border-gray-300 px-2 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                            />
                            <span className="text-xs text-gray-400">–</span>
                            <input
                              name="end_time"
                              type="time"
                              defaultValue={entry.end_time || ""}
                              required
                              className="h-8 w-24 rounded border border-gray-300 px-2 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                            />
                            <button type="submit" className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700">
                              Save
                            </button>
                          </form>
                          <form action={deleteDayScheduleEntry}>
                            <input type="hidden" name="entry_id" value={entry.id} />
                            <input type="hidden" name="schedule_id" value={ds.id} />
                            <button type="submit" className="rounded-md p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </form>
                        </div>
                      ))}

                      {/* Add entry */}
                      {templates && templates.length > 0 && (
                        <form action={addDayScheduleEntry} className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white p-3 dark:border-gray-600 dark:bg-gray-900">
                          <input type="hidden" name="schedule_id" value={ds.id} />
                          <select
                            name="template_id"
                            required
                            className="h-8 flex-1 rounded border border-gray-300 px-2 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                          >
                            <option value="">Add event...</option>
                            {templates.map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                          <input
                            name="start_time"
                            type="time"
                            required
                            className="h-8 w-24 rounded border border-gray-300 px-2 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                          />
                          <span className="text-xs text-gray-400">–</span>
                          <input
                            name="end_time"
                            type="time"
                            required
                            className="h-8 w-24 rounded border border-gray-300 px-2 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                          />
                          <button type="submit" className="inline-flex h-8 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-medium text-white hover:bg-blue-700">
                            <Plus className="h-3 w-3" />
                            Add
                          </button>
                        </form>
                      )}
                    </div>

                    <div className="mt-3">
                      <a href="/admin/events/templates?tab=schedules" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300">
                        ← Done editing
                      </a>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create New Day Schedule */}
      {!editingDayScheduleId && (
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              <h2 className="font-semibold text-gray-800 dark:text-white/90">
                New Day Schedule
              </h2>
            </div>
          </div>
          <div className="p-6">
            <form action={createDaySchedule} className="space-y-4">
              <div className="space-y-1.5">
                <label className={labelClass}>Schedule Name *</label>
                <input
                  name="name"
                  required
                  placeholder="e.g. Monday & Wednesday"
                  className={inputClass + " placeholder:text-gray-400 dark:placeholder:text-white/30"}
                />
              </div>

              <div className="space-y-1.5">
                <label className={labelClass}>Events</label>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Add events to this schedule. Select a template and set the time for each.
                </p>
                {templates && templates.length > 0 ? (
                  <div className="space-y-2" id="new-schedule-entries">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-900">
                        <select
                          name={`entry_${i}_template_id`}
                          className="h-8 flex-1 rounded border border-gray-300 px-2 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                        >
                          <option value="">{i === 0 ? "Select template..." : "(empty — skip)"}</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                        <input
                          name={`entry_${i}_start_time`}
                          type="time"
                          className="h-8 w-24 rounded border border-gray-300 px-2 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                        />
                        <span className="text-xs text-gray-400">–</span>
                        <input
                          name={`entry_${i}_end_time`}
                          type="time"
                          className="h-8 w-24 rounded border border-gray-300 px-2 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                        />
                      </div>
                    ))}
                    <p className="text-xs text-gray-400">
                      Fill in at least one event. Empty rows are skipped. You can add more after creating.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">
                    Create event templates first before creating a day schedule.
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={!templates || templates.length === 0}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                Create Day Schedule
              </button>
            </form>
          </div>
        </div>
      )}

      </>}
    </div>
  );
}
