import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  LayoutTemplate,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
} from "lucide-react";
import { SavedToast } from "@/components/admin/saved-toast";

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
    location?: string;
  }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const { data: templates } = await supabase
    .from("event_templates")
    .select("*")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false });

  const editingId = params.edit;
  const editingTemplate = templates?.find((t) => t.id === editingId);

  async function createTemplate(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();

    const name = formData.get("name") as string;
    const startTime = (formData.get("start_time") as string) || null;
    const endTime = (formData.get("end_time") as string) || null;
    const config = {
      capacity: parseInt(formData.get("capacity") as string, 10) || 12,
      price_cents: Math.round((parseFloat(formData.get("price") as string) || 0) * 100),
      members_only: formData.get("members_only") === "true",
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
      start_time: startTime,
      end_time: endTime,
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
    redirect("/admin/events/templates?saved=true");
  }

  async function updateTemplate(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const startTime = (formData.get("start_time") as string) || null;
    const endTime = (formData.get("end_time") as string) || null;
    const config = {
      capacity: parseInt(formData.get("capacity") as string, 10) || 12,
      price_cents: Math.round((parseFloat(formData.get("price") as string) || 0) * 100),
      members_only: formData.get("members_only") === "true",
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
      start_time: startTime,
      end_time: endTime,
    };

    const { error } = await supabase
      .from("event_templates")
      .update({ name, config })
      .eq("id", id);

    if (error) {
      redirect(`/admin/events/templates?edit=${id}&error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/admin/events/templates");
    redirect("/admin/events/templates?saved=true");
  }

  async function deleteTemplate(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    await supabase.from("event_templates").delete().eq("id", id);
    revalidatePath("/admin/events/templates");
    redirect("/admin/events/templates");
  }

  const inputClass =
    "h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";
  const labelClass = "text-xs font-medium text-gray-500 dark:text-gray-400";

  return (
    <div className="space-y-6">
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
              Event Templates
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Save reusable event configurations to speed up event creation.
            </p>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {params.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {params.error}
        </div>
      )}
      <SavedToast message="Template saved." />

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
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <label className={labelClass}>Template Name *</label>
                  <input name="name" required defaultValue={editingTemplate.name} className={inputClass} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className={labelClass}>Description</label>
                  <input name="description" defaultValue={editingTemplate.config?.description || ""} className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Default Start Time</label>
                  <input name="start_time" type="time" defaultValue={editingTemplate.config?.start_time || ""} className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Default End Time</label>
                  <input name="end_time" type="time" defaultValue={editingTemplate.config?.end_time || ""} className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Default Capacity</label>
                  <input name="capacity" type="number" min="1" defaultValue={editingTemplate.config?.capacity || 12} className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Default Price ($)</label>
                  <input name="price" type="number" step="0.01" min="0" defaultValue={((editingTemplate.config?.price_cents || 0) / 100).toFixed(2)} className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Guest Enrollment (days before)</label>
                  <input name="guest_enrollment_days_before" type="number" min="0" defaultValue={editingTemplate.config?.guest_enrollment_days_before || 7} className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Waitlist Window (hours)</label>
                  <input name="waitlist_promotion_hours" type="number" min="1" defaultValue={editingTemplate.config?.waitlist_promotion_hours || 24} className={inputClass} />
                </div>
              </div>
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
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {tpl.name}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {tpl.config?.start_time && tpl.config?.end_time
                      ? `${tpl.config.start_time} – ${tpl.config.end_time} · `
                      : ""}
                    {tpl.config?.capacity || "?"} spots ·{" "}
                    {tpl.config?.price_cents
                      ? `$${(tpl.config.price_cents / 100).toFixed(2)}`
                      : "Free"}
                    {tpl.config?.members_only ? " · Members Only" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/admin/events/create?template=${tpl.id}`}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-400"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Use
                  </Link>
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
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <label className={labelClass}>Template Name *</label>
                  <input name="name" required placeholder="e.g. Saturday Open Court" className={inputClass + " placeholder:text-gray-400 dark:placeholder:text-white/30"} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className={labelClass}>Description</label>
                  <input name="description" placeholder="Optional default description" className={inputClass + " placeholder:text-gray-400 dark:placeholder:text-white/30"} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Default Start Time</label>
                  <input name="start_time" type="time" className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Default End Time</label>
                  <input name="end_time" type="time" className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Default Capacity</label>
                  <input name="capacity" type="number" min="1" defaultValue="12" className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Default Price ($)</label>
                  <input name="price" type="number" step="0.01" min="0" defaultValue="0.00" className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Guest Enrollment (days before)</label>
                  <input name="guest_enrollment_days_before" type="number" min="0" defaultValue="7" className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Waitlist Window (hours)</label>
                  <input name="waitlist_promotion_hours" type="number" min="1" defaultValue="24" className={inputClass} />
                </div>
              </div>
              <button type="submit" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700">
                <Plus className="h-4 w-4" />
                Create Template
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
