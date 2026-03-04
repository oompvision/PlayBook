import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { getTodayInTimezone } from "@/lib/utils";
import { resolveLocationId } from "@/lib/location";
import {
  DollarSign,
  TrendingUp,
  CalendarCheck,
  Receipt,
  BarChart3,
} from "lucide-react";

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

export default async function RevenueSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const today = getTodayInTimezone(org.timezone);
  const locationId = await resolveLocationId(org.id, params.location);

  // Get the first day of current month
  const monthStart = today.slice(0, 7) + "-01";

  // Fetch all confirmed bookings for metrics
  const allBookingsQuery = supabase
    .from("bookings")
    .select("id, date, total_price_cents, status, bay_id")
    .eq("org_id", org.id)
    .eq("status", "confirmed");
  if (locationId) allBookingsQuery.eq("location_id", locationId);
  const { data: allBookings } = await allBookingsQuery;

  // Fetch bays for facility breakdown
  const baysQuery = supabase
    .from("bays")
    .select("id, name")
    .eq("org_id", org.id)
    .order("sort_order")
    .order("created_at");
  if (locationId) baysQuery.eq("location_id", locationId);
  const { data: bays } = await baysQuery;

  const bayMap: Record<string, string> = {};
  if (bays) {
    for (const b of bays) {
      bayMap[b.id] = b.name;
    }
  }

  // Compute metrics
  const totalRevenue =
    allBookings?.reduce((sum, b) => sum + b.total_price_cents, 0) ?? 0;
  const thisMonthBookings =
    allBookings?.filter((b) => b.date >= monthStart) ?? [];
  const monthRevenue = thisMonthBookings.reduce(
    (sum, b) => sum + b.total_price_cents,
    0
  );
  const totalBookings = allBookings?.length ?? 0;
  const avgBookingValue =
    totalBookings > 0 ? Math.round(totalRevenue / totalBookings) : 0;

  // Revenue by facility
  const revenueByFacility: Record<
    string,
    { name: string; revenue: number; count: number }
  > = {};
  if (allBookings) {
    for (const b of allBookings) {
      const name = bayMap[b.bay_id] ?? "Unknown";
      if (!revenueByFacility[b.bay_id]) {
        revenueByFacility[b.bay_id] = { name, revenue: 0, count: 0 };
      }
      revenueByFacility[b.bay_id].revenue += b.total_price_cents;
      revenueByFacility[b.bay_id].count += 1;
    }
  }
  const facilityBreakdown = Object.values(revenueByFacility).sort(
    (a, b) => b.revenue - a.revenue
  );

  // Revenue by recent dates (last 14 days)
  const revenueByDate: Record<string, { revenue: number; count: number }> = {};
  if (allBookings) {
    for (const b of allBookings) {
      if (!revenueByDate[b.date]) {
        revenueByDate[b.date] = { revenue: 0, count: 0 };
      }
      revenueByDate[b.date].revenue += b.total_price_cents;
      revenueByDate[b.date].count += 1;
    }
  }
  const dateBreakdown = Object.entries(revenueByDate)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 14);

  // Max revenue for relative bar widths
  const maxDailyRevenue = Math.max(
    ...dateBreakdown.map(([, d]) => d.revenue),
    1
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Revenue
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Revenue summary by day, facility, and overall performance.
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 dark:bg-green-900/20">
              <DollarSign className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Total Revenue
              </p>
              <p className="text-xl font-bold text-gray-800 dark:text-white/90">
                ${(totalRevenue / 100).toFixed(2)}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/20">
              <TrendingUp className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                This Month
              </p>
              <p className="text-xl font-bold text-gray-800 dark:text-white/90">
                ${(monthRevenue / 100).toFixed(2)}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-900/20">
              <CalendarCheck className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Total Bookings
              </p>
              <p className="text-xl font-bold text-gray-800 dark:text-white/90">
                {totalBookings}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-900/20">
              <Receipt className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Avg Booking
              </p>
              <p className="text-xl font-bold text-gray-800 dark:text-white/90">
                ${(avgBookingValue / 100).toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Daily Revenue */}
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              <h2 className="font-semibold text-gray-800 dark:text-white/90">
                Daily Revenue
              </h2>
            </div>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              Last 14 days with booking activity.
            </p>
          </div>

          {dateBreakdown.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <BarChart3 className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                No revenue data yet.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {dateBreakdown.map(([date, data]) => {
                const dateStr = new Date(date + "T12:00:00").toLocaleDateString(
                  "en-US",
                  {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  }
                );
                const barWidth = Math.round(
                  (data.revenue / maxDailyRevenue) * 100
                );
                const isToday = date === today;

                return (
                  <div
                    key={date}
                    className="px-6 py-3 transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span
                          className={`text-sm ${
                            isToday
                              ? "font-semibold text-blue-600 dark:text-blue-400"
                              : "text-gray-800 dark:text-white/90"
                          }`}
                        >
                          {dateStr}
                          {isToday && (
                            <span className="ml-1.5 text-xs text-blue-500">
                              Today
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {data.count} booking{data.count !== 1 ? "s" : ""}
                        </span>
                        <span className="min-w-[80px] text-right text-sm font-semibold text-gray-800 dark:text-white/90">
                          ${(data.revenue / 100).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        className="h-full rounded-full bg-green-400 transition-all dark:bg-green-500"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Revenue by Facility */}
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              <h2 className="font-semibold text-gray-800 dark:text-white/90">
                Revenue by Facility
              </h2>
            </div>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              All-time revenue breakdown per facility.
            </p>
          </div>

          {facilityBreakdown.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Receipt className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                No facility revenue data yet.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-white/[0.05]">
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      Facility
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      Bookings
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                      Revenue
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {facilityBreakdown.map((facility, idx) => (
                    <tr
                      key={idx}
                      className="transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]"
                    >
                      <td className="px-6 py-3.5">
                        <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                          {facility.name}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          {facility.count}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <span className="text-sm font-semibold text-gray-800 dark:text-white/90">
                          ${(facility.revenue / 100).toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {/* Total row */}
                  <tr className="bg-gray-50 dark:bg-white/[0.02]">
                    <td className="px-6 py-3.5">
                      <span className="text-sm font-semibold text-gray-800 dark:text-white/90">
                        Total
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        {totalBookings}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <span className="text-sm font-bold text-gray-800 dark:text-white/90">
                        ${(totalRevenue / 100).toFixed(2)}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
