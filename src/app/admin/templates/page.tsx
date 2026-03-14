import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  LayoutTemplate,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { SavedToast } from "@/components/admin/saved-toast";
import { TemplateSlotEditor } from "@/components/admin/template-slot-editor";
import { resolveLocationId } from "@/lib/location";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, default_slot_duration_minutes, scheduling_type, locations_enabled")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; error?: string; saved?: string; location?: string }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const locationId = org.locations_enabled
    ? await resolveLocationId(org.id, params.location)
    : null;

  if (org.scheduling_type === "dynamic") {
    return (
      <div className="mx-auto max-w-[1100px] space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Templates
          </h1>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400">
          Your facility uses Dynamic Scheduling. Templates are not used in this
          mode — available times are calculated automatically from your schedule
          rules.{" "}
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

  let templatesQuery = supabase
    .from("schedule_templates")
    .select("*, template_slots(*)")
    .eq("org_id", org.id)
    .order("created_at");
  if (locationId) templatesQuery = templatesQuery.eq("location_id", locationId);

  let baysQuery = supabase
    .from("bays")
    .select("id, name, hourly_rate_cents")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("sort_order");
  if (locationId) baysQuery = baysQuery.eq("location_id", locationId);

  const [{ data: templates }, { data: bays }] = await Promise.all([
    templatesQuery,
    baysQuery,
  ]);

  async function createTemplate(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();

    const name = formData.get("name") as string;
    const description = (formData.get("description") as string) || null;
    let locId = (formData.get("location_id") as string) || null;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";

    // If no location_id from form (e.g. locations_enabled is off), resolve the default
    if (!locId) {
      locId = await resolveLocationId(org.id);
    }

    const { data: template, error } = await supabase
      .from("schedule_templates")
      .insert({ org_id: org.id, name, description, ...(locId ? { location_id: locId } : {}) })
      .select("id")
      .single();

    if (error) {
      redirect(`/admin/templates?error=${encodeURIComponent(error.message)}${locParam}`);
    }
    redirect(`/admin/templates?edit=${template.id}&saved=true${locParam}`);
  }

  async function updateTemplate(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const description = (formData.get("description") as string) || null;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";

    const { error } = await supabase
      .from("schedule_templates")
      .update({ name, description })
      .eq("id", id);

    if (error) {
      redirect(
        `/admin/templates?edit=${id}&error=${encodeURIComponent(error.message)}${locParam}`
      );
    }
    revalidatePath("/admin/templates");
    redirect(`/admin/templates?edit=${id}&saved=true${locParam}`);
  }

  async function deleteTemplate(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `?location=${loc}` : "";
    await supabase.from("schedule_templates").delete().eq("id", id);
    revalidatePath("/admin/templates");
    redirect(`/admin/templates${locParam}`);
  }

  async function generateSlots(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();
    const templateId = formData.get("template_id") as string;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";
    const openTime = formData.get("open_time") as string;
    const closeTime = formData.get("close_time") as string;
    const durationMin =
      parseInt(formData.get("duration") as string) ||
      org.default_slot_duration_minutes;
    const slots: {
      template_id: string;
      start_time: string;
      end_time: string;
    }[] = [];

    const [openH, openM] = openTime.split(":").map(Number);
    const [closeH, closeM] = closeTime.split(":").map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    for (
      let t = openMinutes;
      t + durationMin <= closeMinutes;
      t += durationMin
    ) {
      const sh = Math.floor(t / 60);
      const sm = t % 60;
      const eh = Math.floor((t + durationMin) / 60);
      const em = (t + durationMin) % 60;
      slots.push({
        template_id: templateId,
        start_time: `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`,
        end_time: `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`,
      });
    }

    if (slots.length > 0) {
      await supabase
        .from("template_slots")
        .delete()
        .eq("template_id", templateId);

      const { error } = await supabase.from("template_slots").insert(slots);
      if (error) {
        redirect(
          `/admin/templates?edit=${templateId}&error=${encodeURIComponent(error.message)}${locParam}`
        );
      }
    }

    revalidatePath("/admin/templates");
    redirect(`/admin/templates?edit=${templateId}&saved=true${locParam}`);
  }

  const editingTemplate = params.edit
    ? templates?.find((t) => t.id === params.edit)
    : null;

  // Fetch per-bay price overrides for the editing template
  let overrides: {
    id: string;
    template_slot_id: string;
    bay_id: string;
    price_cents: number;
  }[] = [];
  if (editingTemplate) {
    const { data } = await supabase
      .from("template_bay_overrides")
      .select("id, template_slot_id, bay_id, price_cents")
      .eq("template_id", editingTemplate.id);
    overrides = data || [];
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Templates
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Create reusable schedule templates with time slots. Each bay has
          its own pricing tab, defaulting to its hourly rate.
        </p>
      </div>

      {/* Alerts */}
      {params.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {params.error}
        </div>
      )}

      <SavedToast message="Template saved successfully." />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Template List Sidebar */}
        <div className="space-y-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Your Templates
          </h2>

          {(!templates || templates.length === 0) && (
            <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white px-5 py-8 text-center dark:border-gray-700 dark:bg-white/[0.03]">
              <LayoutTemplate className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                No templates yet.
              </p>
            </div>
          )}

          {templates?.map((t) => (
            <a
              key={t.id}
              href={`/admin/templates?edit=${t.id}${locationId ? `&location=${locationId}` : ""}`}
              className={`block rounded-xl border p-4 transition-colors ${
                editingTemplate?.id === t.id
                  ? "border-blue-300 bg-blue-50/50 ring-1 ring-blue-100 dark:border-blue-700 dark:bg-blue-950/20 dark:ring-blue-900"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-white/[0.05] dark:bg-white/[0.03] dark:hover:bg-white/[0.05]"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                    editingTemplate?.id === t.id
                      ? "bg-blue-100 dark:bg-blue-900/30"
                      : "bg-gray-100 dark:bg-gray-800"
                  }`}
                >
                  <LayoutTemplate
                    className={`h-4 w-4 ${
                      editingTemplate?.id === t.id
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {t.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t.template_slots?.length || 0} slots
                    {t.description ? ` · ${t.description}` : ""}
                  </p>
                </div>
              </div>
            </a>
          ))}

          {/* New Template Form */}
          <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
            <div className="border-b border-gray-200 px-4 py-3 dark:border-white/[0.05]">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
                  New Template
                </h3>
              </div>
            </div>
            <div className="p-4">
              <form action={createTemplate} className="space-y-3">
                {locationId && (
                  <input type="hidden" name="location_id" value={locationId} />
                )}
                {locationId && (
                  <input type="hidden" name="location" value={locationId} />
                )}
                <input
                  name="name"
                  placeholder="e.g. Weekday Hours"
                  required
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                />
                <input
                  name="description"
                  placeholder="Description (optional)"
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                />
                <button
                  type="submit"
                  className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  Create Template
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Template Editor */}
        <div className="lg:col-span-2">
          {!editingTemplate ? (
            <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white p-16 text-center dark:border-gray-700 dark:bg-white/[0.03]">
              <LayoutTemplate className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
              <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                Select a template to edit
              </p>
              <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
                Or create a new one from the sidebar.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Template Details Card */}
              <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
                <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
                  <h2 className="font-semibold text-gray-800 dark:text-white/90">
                    {editingTemplate.name}
                  </h2>
                  <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                    Edit template details and manage time slots.
                  </p>
                </div>
                <div className="p-6">
                  <form action={updateTemplate} className="space-y-4">
                    <input
                      type="hidden"
                      name="id"
                      value={editingTemplate.id}
                    />
                    {locationId && (
                      <input type="hidden" name="location" value={locationId} />
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          Name
                        </label>
                        <input
                          name="name"
                          defaultValue={editingTemplate.name}
                          required
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          Description
                        </label>
                        <input
                          name="description"
                          defaultValue={editingTemplate.description || ""}
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
                      >
                        Save Details
                      </button>
                    </div>
                  </form>
                  <form action={deleteTemplate} className="mt-2">
                    <input
                      type="hidden"
                      name="id"
                      value={editingTemplate.id}
                    />
                    {locationId && (
                      <input type="hidden" name="location" value={locationId} />
                    )}
                    <button
                      type="submit"
                      className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 dark:border-gray-700 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete Template
                    </button>
                  </form>
                </div>
              </div>

              {/* Quick Generate Card */}
              <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
                <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-500" />
                    <h2 className="font-semibold text-gray-800 dark:text-white/90">
                      Quick Generate Slots
                    </h2>
                  </div>
                  <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                    Auto-generate evenly spaced slots. This replaces all
                    existing slots.
                  </p>
                </div>
                <div className="p-6">
                  <form action={generateSlots} className="space-y-4">
                    <input
                      type="hidden"
                      name="template_id"
                      value={editingTemplate.id}
                    />
                    {locationId && (
                      <input type="hidden" name="location" value={locationId} />
                    )}
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          Open Time
                        </label>
                        <input
                          name="open_time"
                          type="time"
                          defaultValue="09:00"
                          required
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          Close Time
                        </label>
                        <input
                          name="close_time"
                          type="time"
                          defaultValue="21:00"
                          required
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          Duration (min)
                        </label>
                        <input
                          name="duration"
                          type="number"
                          min={15}
                          max={240}
                          step={15}
                          defaultValue={org.default_slot_duration_minutes}
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-amber-500 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-600"
                    >
                      <Zap className="h-4 w-4" />
                      Generate Slots
                    </button>
                  </form>
                </div>
              </div>

              {/* Time Slots & Pricing (bay-tabbed client component) */}
              <TemplateSlotEditor
                templateId={editingTemplate.id}
                initialSlots={
                  editingTemplate.template_slots?.map(
                    (s: { id: string; start_time: string; end_time: string }) => ({
                      id: s.id,
                      start_time: s.start_time,
                      end_time: s.end_time,
                    })
                  ) || []
                }
                bays={bays || []}
                initialOverrides={overrides}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
