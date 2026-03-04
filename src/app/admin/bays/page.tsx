import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resolveLocationId } from "@/lib/location";
import { Button } from "@/components/ui/button";
import {
  Box,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  CheckCircle2,
} from "lucide-react";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function BayManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; error?: string; saved?: string; location?: string }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const locationId = await resolveLocationId(org.id, params.location);

  const baysQuery = supabase
    .from("bays")
    .select("*")
    .eq("org_id", org.id)
    .order("sort_order")
    .order("created_at");
  if (locationId) baysQuery.eq("location_id", locationId);
  const { data: bays } = await baysQuery;

  const editingId = params.edit;

  async function createBay(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();

    const name = formData.get("name") as string;
    const hourlyRate = parseFloat(formData.get("hourly_rate") as string) || 0;
    const resourceType = (formData.get("resource_type") as string) || null;
    const description = (formData.get("description") as string) || null;
    const locationIdValue = (formData.get("location_id") as string) || null;

    const { data: maxBay } = await supabase
      .from("bays")
      .select("sort_order")
      .eq("org_id", org.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .single();

    const nextOrder = (maxBay?.sort_order ?? -1) + 1;

    const insertData: Record<string, unknown> = {
      org_id: org.id,
      name,
      hourly_rate_cents: Math.round(hourlyRate * 100),
      resource_type: resourceType,
      description,
      sort_order: nextOrder,
    };
    if (locationIdValue) insertData.location_id = locationIdValue;

    const { error } = await supabase.from("bays").insert(insertData);

    if (error) {
      redirect(`/admin/bays?error=${encodeURIComponent(error.message)}`);
    }
    revalidatePath("/admin/bays");
    redirect("/admin/bays?saved=true");
  }

  async function updateBay(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const hourlyRate = parseFloat(formData.get("hourly_rate") as string) || 0;
    const resourceType = (formData.get("resource_type") as string) || null;
    const description = (formData.get("description") as string) || null;

    const { error } = await supabase
      .from("bays")
      .update({
        name,
        hourly_rate_cents: Math.round(hourlyRate * 100),
        resource_type: resourceType,
        description,
      })
      .eq("id", id);

    if (error) {
      redirect(
        `/admin/bays?edit=${id}&error=${encodeURIComponent(error.message)}`
      );
    }
    revalidatePath("/admin/bays");
    redirect("/admin/bays?saved=true");
  }

  async function toggleBay(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    const newStatus = formData.get("is_active") === "true";

    await supabase.from("bays").update({ is_active: newStatus }).eq("id", id);
    revalidatePath("/admin/bays");
  }

  async function deleteBay(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    await supabase.from("bays").delete().eq("id", id);
    revalidatePath("/admin/bays");
    redirect("/admin/bays");
  }

  const activeBays = bays?.filter((b) => b.is_active).length ?? 0;
  const totalBays = bays?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Facilities
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage your bookable resources — simulator facilities, courts, and
            more.
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {activeBays} active / {totalBays} total
        </span>
      </div>

      {/* Alerts */}
      {params.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {params.error}
        </div>
      )}
      {params.saved && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Changes saved successfully.
        </div>
      )}

      {/* Edit form (if editing) */}
      {editingId &&
        bays?.map(
          (bay) =>
            editingId === bay.id && (
              <div
                key={bay.id}
                className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]"
              >
                <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
                  <h2 className="font-semibold text-gray-800 dark:text-white/90">
                    Edit Facility
                  </h2>
                  <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                    Update facility details.
                  </p>
                </div>
                <div className="p-6">
                  <form action={updateBay} className="space-y-4">
                    <input type="hidden" name="id" value={bay.id} />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          Name
                        </label>
                        <input
                          name="name"
                          defaultValue={bay.name}
                          required
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          Hourly Rate ($)
                        </label>
                        <input
                          name="hourly_rate"
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={(bay.hourly_rate_cents / 100).toFixed(2)}
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          Facility Type
                        </label>
                        <input
                          name="resource_type"
                          placeholder="e.g. Golf Simulator, Tennis Court"
                          defaultValue={bay.resource_type || ""}
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          Description
                        </label>
                        <input
                          name="description"
                          placeholder="Optional notes"
                          defaultValue={bay.description || ""}
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
                      >
                        Save Changes
                      </button>
                      <a href="/admin/bays">
                        <button
                          type="button"
                          className="inline-flex h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          Cancel
                        </button>
                      </a>
                    </div>
                  </form>
                </div>
              </div>
            )
        )}

      {/* Facilities Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        {(!bays || bays.length === 0) ? (
          <div className="px-6 py-16 text-center">
            <Box className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
              No facilities yet
            </p>
            <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
              Add your first facility below to start managing bookings.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-white/[0.05]">
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Rate
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Status
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                    {bays.map((bay) => (
                      <tr
                        key={bay.id}
                        className="transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]"
                      >
                        <td className="px-6 py-4">
                          <div>
                            <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                              {bay.name}
                            </p>
                            {bay.description && (
                              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                {bay.description}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {bay.resource_type ? (
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                              {bay.resource_type}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-semibold text-gray-800 dark:text-white/90">
                            ${(bay.hourly_rate_cents / 100).toFixed(2)}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            /hr
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              bay.is_active
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                            }`}
                          >
                            {bay.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <form action={toggleBay}>
                              <input type="hidden" name="id" value={bay.id} />
                              <input
                                type="hidden"
                                name="is_active"
                                value={bay.is_active ? "false" : "true"}
                              />
                              <button
                                type="submit"
                                className="rounded-lg border border-gray-300 bg-white p-2 text-gray-500 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800"
                                title={
                                  bay.is_active ? "Deactivate" : "Activate"
                                }
                              >
                                {bay.is_active ? (
                                  <ToggleRight className="h-4 w-4 text-green-500" />
                                ) : (
                                  <ToggleLeft className="h-4 w-4" />
                                )}
                              </button>
                            </form>
                            <a href={`/admin/bays?edit=${bay.id}`}>
                              <button className="rounded-lg border border-gray-300 bg-white p-2 text-gray-500 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800">
                                <Pencil className="h-4 w-4" />
                              </button>
                            </a>
                            <form action={deleteBay}>
                              <input type="hidden" name="id" value={bay.id} />
                              <button
                                type="submit"
                                className="rounded-lg border border-gray-300 bg-white p-2 text-red-500 shadow-sm transition-colors hover:bg-red-50 dark:border-gray-700 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Card View */}
            <div className="divide-y divide-gray-100 md:hidden dark:divide-white/[0.05]">
              {bays.map((bay) => (
                <div key={bay.id} className="px-5 py-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                          {bay.name}
                        </p>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            bay.is_active
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                          }`}
                        >
                          {bay.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        ${(bay.hourly_rate_cents / 100).toFixed(2)}/hr
                        {bay.resource_type ? ` · ${bay.resource_type}` : ""}
                        {bay.description ? ` · ${bay.description}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <form action={toggleBay}>
                        <input type="hidden" name="id" value={bay.id} />
                        <input
                          type="hidden"
                          name="is_active"
                          value={bay.is_active ? "false" : "true"}
                        />
                        <button
                          type="submit"
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          {bay.is_active ? (
                            <ToggleRight className="h-4 w-4 text-green-500" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                        </button>
                      </form>
                      <a href={`/admin/bays?edit=${bay.id}`}>
                        <button className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800">
                          <Pencil className="h-4 w-4" />
                        </button>
                      </a>
                      <form action={deleteBay}>
                        <input type="hidden" name="id" value={bay.id} />
                        <button
                          type="submit"
                          className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Add New Facility */}
      {!editingId && (
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              <h2 className="font-semibold text-gray-800 dark:text-white/90">
                Add New Facility
              </h2>
            </div>
          </div>
          <div className="p-6">
            <form action={createBay} className="space-y-4">
              <input type="hidden" name="location_id" value={locationId || ""} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Name
                  </label>
                  <input
                    name="name"
                    placeholder="e.g. Facility 1, Court A"
                    required
                    className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Hourly Rate ($)
                  </label>
                  <input
                    name="hourly_rate"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue="0"
                    className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Facility Type
                  </label>
                  <input
                    name="resource_type"
                    placeholder="e.g. Golf Simulator, Tennis Court"
                    className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Description
                  </label>
                  <input
                    name="description"
                    placeholder="Optional notes"
                    className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                Add Facility
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
