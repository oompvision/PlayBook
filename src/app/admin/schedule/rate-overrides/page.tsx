import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { resolveLocationId } from "@/lib/location";
import { RateOverridesEditor } from "@/components/admin/rate-overrides-editor";

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

export default async function RateOverridesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const locationId = await resolveLocationId(org.id, params.location);

  const baysQuery = supabase
    .from("bays")
    .select("id, name, resource_type, hourly_rate_cents")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("sort_order");
  if (locationId) baysQuery.eq("location_id", locationId);

  const overridesQuery = supabase
    .from("dynamic_rate_overrides")
    .select("*")
    .eq("org_id", org.id)
    .order("date", { ascending: true });
  if (locationId) overridesQuery.eq("location_id", locationId);

  const [{ data: bays }, { data: overrides }] = await Promise.all([
    baysQuery,
    overridesQuery,
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Rate Overrides
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Set custom hourly rates for specific dates and time ranges. Overrides
          take priority over the default bay rate and rate tiers.
        </p>
      </div>

      {org.scheduling_type !== "dynamic" && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
          Your facility uses Slot-Based Scheduling. Rate overrides only
          apply to Dynamic Scheduling mode. Switch in{" "}
          <a
            href="/admin/settings/scheduling"
            className="font-medium underline underline-offset-2"
          >
            Settings
          </a>
          .
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
        <RateOverridesEditor
          orgId={org.id}
          timezone={org.timezone}
          bays={bays}
          existingOverrides={overrides || []}
        />
      )}
    </div>
  );
}
