import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { FacilityGroupsEditor } from "@/components/admin/facility-groups-editor";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, scheduling_type")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function FacilityGroupsPage() {
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();

  const [{ data: bays }, { data: groups }, { data: members }, { data: rules }] =
    await Promise.all([
      supabase
        .from("bays")
        .select("id, name, resource_type, hourly_rate_cents")
        .eq("org_id", org.id)
        .eq("is_active", true)
        .order("sort_order"),
      supabase
        .from("facility_groups")
        .select("id, name, description")
        .eq("org_id", org.id)
        .order("created_at"),
      supabase
        .from("facility_group_members")
        .select("id, group_id, bay_id"),
      supabase
        .from("dynamic_schedule_rules")
        .select("bay_id, day_of_week, open_time, close_time, buffer_minutes, start_time_granularity, available_durations")
        .eq("org_id", org.id),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Facility Groups
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Group interchangeable facilities together. Customers booking a group
          see pooled availability and are auto-assigned a specific facility.
        </p>
      </div>

      {org.scheduling_type !== "dynamic" && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
          Facility groups are used with Dynamic Scheduling. Switch to Dynamic
          mode in{" "}
          <a
            href="/admin/settings"
            className="font-medium underline underline-offset-2"
          >
            Settings
          </a>{" "}
          to use this feature.
        </div>
      )}

      {!bays || bays.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center dark:border-white/[0.05] dark:bg-white/[0.03]">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            No active facilities
          </p>
          <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
            Add facilities in the{" "}
            <a
              href="/admin/bays"
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Facilities
            </a>{" "}
            page first.
          </p>
        </div>
      ) : (
        <FacilityGroupsEditor
          orgId={org.id}
          bays={bays}
          existingGroups={groups || []}
          existingMembers={members || []}
          existingRules={rules || []}
        />
      )}
    </div>
  );
}
