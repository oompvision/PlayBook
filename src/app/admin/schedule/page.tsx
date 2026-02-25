import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { getTodayInTimezone } from "@/lib/utils";
import { ScheduleCalendar } from "@/components/admin/schedule-calendar";
import { addMonths, endOfMonth, format } from "date-fns";

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

export default async function ScheduleManagerPage() {
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const today = getTodayInTimezone(org.timezone);

  // Date range: today through end of 12th month from now
  const todayDate = new Date(today + "T12:00:00");
  const endDate = endOfMonth(addMonths(todayDate, 12));
  const endDateStr = format(endDate, "yyyy-MM-dd");

  // Fetch active bays (count only) and bay_schedules for coverage data
  const [baysResult, schedulesResult] = await Promise.all([
    supabase
      .from("bays")
      .select("id")
      .eq("org_id", org.id)
      .eq("is_active", true),
    supabase
      .from("bay_schedules")
      .select("date, bay_id")
      .eq("org_id", org.id)
      .gte("date", today)
      .lte("date", endDateStr),
  ]);

  const bays = baysResult.data || [];
  const schedules = schedulesResult.data || [];

  // Aggregate: date → count of bays with published schedules
  const coverageMap: Record<string, number> = {};
  for (const s of schedules) {
    coverageMap[s.date] = (coverageMap[s.date] || 0) + 1;
  }

  return (
    <ScheduleCalendar
      today={today}
      totalBays={bays.length}
      coverageMap={coverageMap}
    />
  );
}
