"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  MapPin,
  CalendarDays,
} from "lucide-react";

type BayStats = {
  bayId: string;
  bayName: string;
  upcoming: number;
  active: number;
  completed: number;
  cancelled: number;
  revenueCents: number;
  events: { name: string; registered: number; capacity: number }[];
};

type LocationData = {
  locationId: string;
  locationName: string;
  locationAddress: string | null;
  bays: BayStats[];
};

type DashboardProps = {
  date: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD
  timezone: string;
  locations: LocationData[];
  renderedAt: string; // ISO timestamp
};

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const ny = date.getFullYear();
  const nm = String(date.getMonth() + 1).padStart(2, "0");
  const nd = String(date.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
    green: "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
    red: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
    purple: "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400",
  };

  return (
    <div className="flex flex-col items-center rounded-xl border border-gray-100 bg-white px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.03]">
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </span>
      <span
        className={`mt-1 rounded-lg px-2.5 py-0.5 text-lg font-bold ${colorMap[color] || colorMap.blue}`}
      >
        {value}
      </span>
    </div>
  );
}

function EventBadge({
  event,
}: {
  event: { name: string; registered: number; capacity: number };
}) {
  const pct = Math.round((event.registered / event.capacity) * 100);
  const isFull = event.registered >= event.capacity;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        isFull
          ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
          : "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400"
      }`}
    >
      <CalendarDays className="h-3 w-3" />
      {event.name}
      <span className="font-semibold">
        {event.registered}/{event.capacity}
      </span>
      {isFull && <span className="text-[10px] uppercase tracking-wide">Full</span>}
    </span>
  );
}

export function DailyDashboard({
  date,
  today,
  timezone,
  locations,
  renderedAt,
}: DashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const isToday = date === today;
  const isPast = date < today;
  const isFuture = date > today;

  function navigateToDate(newDate: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (newDate === today) {
      params.delete("date");
    } else {
      params.set("date", newDate);
    }
    const qs = params.toString();
    router.push(`/admin${qs ? `?${qs}` : ""}`);
  }

  function handleRefresh() {
    router.refresh();
  }

  // Format "last refreshed" time in facility timezone
  const refreshedTime = new Date(renderedAt).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  // Determine which columns to show
  const showUpcoming = isToday || isFuture;
  const showActive = isToday;
  const showCompleted = isToday || isPast;

  return (
    <div className="space-y-6">
      {/* Page Header with Date Navigation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Daily Dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {isToday
              ? "Today's activity at a glance."
              : isPast
                ? "Historical view for this date."
                : "Upcoming schedule for this date."}
          </p>
        </div>

        {/* Last Refreshed + Refresh Button */}
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          <span>Last refreshed {refreshedTime}</span>
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-400 dark:hover:bg-white/10"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
      </div>

      {/* Date Navigation */}
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => navigateToDate(shiftDate(date, -1))}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-400 dark:hover:bg-white/10"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              const input = document.getElementById("dashboard-date-picker") as HTMLInputElement;
              input?.showPicker?.();
            }}
            className={`inline-flex h-9 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors ${
              isToday
                ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
            }`}
          >
            {formatDisplayDate(date)}
            {isToday && (
              <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                Today
              </span>
            )}
          </button>
          <input
            id="dashboard-date-picker"
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value) navigateToDate(e.target.value);
            }}
            className="pointer-events-none absolute inset-0 opacity-0"
            tabIndex={-1}
          />
        </div>

        <button
          type="button"
          onClick={() => navigateToDate(shiftDate(date, 1))}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-400 dark:hover:bg-white/10"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {!isToday && (
          <button
            type="button"
            onClick={() => navigateToDate(today)}
            className="ml-2 inline-flex h-9 items-center rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-400 dark:hover:bg-white/10"
          >
            Go to Today
          </button>
        )}
      </div>

      {/* Location Sections */}
      {locations.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center dark:border-white/[0.05] dark:bg-white/[0.03]">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No facilities configured yet. Add facilities to see your daily dashboard.
          </p>
        </div>
      ) : (
        locations.map((loc) => {
          // Compute totals for this location
          const totals = loc.bays.reduce(
            (acc, bay) => ({
              upcoming: acc.upcoming + bay.upcoming,
              active: acc.active + bay.active,
              completed: acc.completed + bay.completed,
              cancelled: acc.cancelled + bay.cancelled,
              revenueCents: acc.revenueCents + bay.revenueCents,
              events: acc.events + bay.events.length,
              registrations: acc.registrations + bay.events.reduce((s, e) => s + e.registered, 0),
              capacity: acc.capacity + bay.events.reduce((s, e) => s + e.capacity, 0),
            }),
            { upcoming: 0, active: 0, completed: 0, cancelled: 0, revenueCents: 0, events: 0, registrations: 0, capacity: 0 }
          );

          return (
            <div
              key={loc.locationId}
              className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]"
            >
              {/* Location Header */}
              <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <h2 className="font-semibold text-gray-800 dark:text-white/90">
                    {loc.locationName}
                  </h2>
                </div>
                {loc.locationAddress && (
                  <p className="mt-0.5 pl-6 text-sm text-gray-500 dark:text-gray-400">
                    {loc.locationAddress}
                  </p>
                )}
              </div>

              {/* Facility Rows */}
              <div className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {loc.bays.length === 0 ? (
                  <div className="px-6 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                    No active facilities at this location.
                  </div>
                ) : (
                  <>
                    {loc.bays.map((bay) => (
                      <div key={bay.bayId} className="px-6 py-4">
                        {/* Bay Name */}
                        <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-white/80">
                          {bay.bayName}
                        </h3>

                        {/* Stat Cards */}
                        <div className="flex flex-wrap gap-2">
                          {showUpcoming && (
                            <StatCard label="Upcoming" value={bay.upcoming} color="blue" />
                          )}
                          {showActive && (
                            <StatCard label="Active" value={bay.active} color="green" />
                          )}
                          {showCompleted && (
                            <StatCard label="Completed" value={bay.completed} color="emerald" />
                          )}
                          <StatCard label="Cancelled" value={bay.cancelled} color="red" />
                          <StatCard
                            label="Revenue"
                            value={`$${(bay.revenueCents / 100).toFixed(2)}`}
                            color="amber"
                          />
                          <StatCard
                            label="Events"
                            value={bay.events.length}
                            color="purple"
                          />
                        </div>

                        {/* Event Badges */}
                        {bay.events.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {bay.events.map((event, i) => (
                              <EventBadge key={i} event={event} />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Totals Row */}
                    {loc.bays.length > 1 && (
                      <div className="bg-gray-50/50 px-6 py-4 dark:bg-white/[0.02]">
                        <h3 className="mb-3 text-sm font-semibold text-gray-500 dark:text-gray-400">
                          Location Totals
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {showUpcoming && (
                            <StatCard label="Upcoming" value={totals.upcoming} color="blue" />
                          )}
                          {showActive && (
                            <StatCard label="Active" value={totals.active} color="green" />
                          )}
                          {showCompleted && (
                            <StatCard label="Completed" value={totals.completed} color="emerald" />
                          )}
                          <StatCard label="Cancelled" value={totals.cancelled} color="red" />
                          <StatCard
                            label="Revenue"
                            value={`$${(totals.revenueCents / 100).toFixed(2)}`}
                            color="amber"
                          />
                          <StatCard
                            label="Events"
                            value={totals.events}
                            color="purple"
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
