import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { formatTimeInZone, getTodayInTimezone } from "@/lib/utils";
import {
  CalendarCheck,
  DollarSign,
  Clock,
  Users,
  ArrowUpRight,
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

export default async function AdminDashboardPage() {
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const today = getTodayInTimezone(org.timezone);

  // Fetch today's bookings
  const { data: todayBookings } = await supabase
    .from("bookings")
    .select("id, total_price_cents, status")
    .eq("org_id", org.id)
    .eq("date", today)
    .eq("status", "confirmed");

  // Fetch upcoming bookings (today and future)
  const { data: upcomingBookings } = await supabase
    .from("bookings")
    .select("id")
    .eq("org_id", org.id)
    .eq("status", "confirmed")
    .gte("date", today);

  // Fetch total customers
  const { data: customers } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", org.id)
    .eq("role", "customer");

  // Fetch recent bookings for the table
  const { data: recentBookings } = await supabase
    .from("bookings")
    .select(
      "id, date, start_time, end_time, total_price_cents, status, confirmation_code, customer_id, bay_id"
    )
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .limit(8);

  // Look up customer names and bay names for recent bookings
  const customerIds = [
    ...new Set(recentBookings?.map((b) => b.customer_id) ?? []),
  ];
  let customerMap: Record<
    string,
    { full_name: string | null; email: string }
  > = {};
  if (customerIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", customerIds);
    if (profiles) {
      for (const p of profiles) {
        customerMap[p.id] = { full_name: p.full_name, email: p.email };
      }
    }
  }

  const { data: bays } = await supabase
    .from("bays")
    .select("id, name")
    .eq("org_id", org.id);
  const bayMap: Record<string, string> = {};
  if (bays) {
    for (const b of bays) {
      bayMap[b.id] = b.name;
    }
  }

  const bookingsToday = todayBookings?.length ?? 0;
  const revenueToday =
    todayBookings?.reduce((sum, b) => sum + b.total_price_cents, 0) ?? 0;
  const upcoming = upcomingBookings?.length ?? 0;
  const totalCustomers = customers?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Today&apos;s bookings and quick stats at a glance.
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/20">
              <CalendarCheck className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Bookings Today
              </p>
              <p className="text-xl font-bold text-gray-800 dark:text-white/90">
                {bookingsToday}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 dark:bg-green-900/20">
              <DollarSign className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Revenue Today
              </p>
              <p className="text-xl font-bold text-gray-800 dark:text-white/90">
                ${(revenueToday / 100).toFixed(2)}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-900/20">
              <Clock className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Upcoming
              </p>
              <p className="text-xl font-bold text-gray-800 dark:text-white/90">
                {upcoming}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-900/20">
              <Users className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Customers
              </p>
              <p className="text-xl font-bold text-gray-800 dark:text-white/90">
                {totalCustomers}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Bookings Table */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-white/90">
              Recent Bookings
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              Latest booking activity across all facilities.
            </p>
          </div>
          <a
            href="/admin/bookings"
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            View all
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>

        {!recentBookings || recentBookings.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-gray-500 dark:text-gray-400">
            No bookings yet. Bookings will appear here once customers start
            making reservations.
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
                        Customer
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Code
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Date & Time
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Facility
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Price
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                    {recentBookings.map((booking) => {
                      const customer = customerMap[booking.customer_id];
                      const timeStr = `${formatTimeInZone(booking.start_time, org.timezone)} – ${formatTimeInZone(booking.end_time, org.timezone)}`;
                      const dateStr = new Date(
                        booking.date
                      ).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      });

                      return (
                        <tr
                          key={booking.id}
                          className="transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]"
                        >
                          <td className="px-6 py-3.5">
                            <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                              {customer?.full_name ||
                                customer?.email ||
                                "Unknown"}
                            </p>
                          </td>
                          <td className="px-6 py-3.5">
                            <span className="font-mono text-sm text-gray-600 dark:text-gray-300">
                              {booking.confirmation_code}
                            </span>
                          </td>
                          <td className="px-6 py-3.5">
                            <div>
                              <p className="text-sm text-gray-800 dark:text-white/90">
                                {dateStr}
                              </p>
                              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                {timeStr}
                              </p>
                            </div>
                          </td>
                          <td className="px-6 py-3.5">
                            <span className="text-sm text-gray-800 dark:text-white/90">
                              {bayMap[booking.bay_id] ?? "Unknown"}
                            </span>
                          </td>
                          <td className="px-6 py-3.5">
                            <span className="text-sm font-semibold text-gray-800 dark:text-white/90">
                              ${(booking.total_price_cents / 100).toFixed(2)}
                            </span>
                          </td>
                          <td className="px-6 py-3.5">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                booking.status === "confirmed"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              }`}
                            >
                              {booking.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Card View */}
            <div className="divide-y divide-gray-100 md:hidden dark:divide-white/[0.05]">
              {recentBookings.map((booking) => {
                const customer = customerMap[booking.customer_id];
                const timeStr = `${formatTimeInZone(booking.start_time, org.timezone)} – ${formatTimeInZone(booking.end_time, org.timezone)}`;
                const dateStr = new Date(booking.date).toLocaleDateString(
                  "en-US",
                  {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  }
                );

                return (
                  <div key={booking.id} className="px-5 py-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                          {customer?.full_name ||
                            customer?.email ||
                            "Unknown"}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                          {bayMap[booking.bay_id] ?? "Unknown"} &middot;{" "}
                          {dateStr}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {timeStr}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                          ${(booking.total_price_cents / 100).toFixed(2)}
                        </p>
                        <span
                          className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            booking.status === "confirmed"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          }`}
                        >
                          {booking.status}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
