import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getTodayInTimezone } from "@/lib/utils";
import { ExportOptionsForm } from "@/components/admin/export-options-form";
import { ArrowLeft } from "lucide-react";

export default async function ExportPage() {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone")
    .eq("slug", slug)
    .single();

  if (!org) redirect("/");
  await requireAdmin(org.id);

  const { data: bays } = await supabase
    .from("bays")
    .select("id, name")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");

  const today = getTodayInTimezone(org.timezone);

  return (
    <div>
      <div className="mb-6">
        <a
          href="/admin/bookings"
          className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Bookings
        </a>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Export Bookings
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Export booking data as a printable PDF or downloadable CSV file.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-white/[0.05] dark:bg-white/[0.03]">
        <ExportOptionsForm
          orgId={org.id}
          orgSlug={org.slug}
          orgTimezone={org.timezone}
          bays={bays ?? []}
          defaultDate={today}
        />
      </div>
    </div>
  );
}
