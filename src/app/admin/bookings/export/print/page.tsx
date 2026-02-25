import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { formatTimeInZone } from "@/lib/utils";
import { PrintPageClient } from "./print-client";

const ROW_HEIGHT = 60; // px per hour for timeline grid

/** Extract decimal hour (e.g. 9.5 for 9:30 AM) from a timestamptz string in a given timezone */
function getHourInTimezone(timestamp: string, timezone: string): number {
  const d = new Date(timestamp);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(d);
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === "hour") hour = parseInt(p.value, 10);
    if (p.type === "minute") minute = parseInt(p.value, 10);
  }
  return hour + minute / 60;
}

/** Format hour number to label: 0→"12 AM", 8→"8 AM", 13→"1 PM", 12→"12 PM" */
function formatHourLabel(hour: number): string {
  if (hour === 0 || hour === 24) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

export default async function PrintPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    bay?: string;
    layout?: string;
  }>;
}) {
  const params = await searchParams;
  const isTimeline = params.layout === "timeline";
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

  const fromDate = params.from;
  const toDate = params.to || params.from;

  if (!fromDate) redirect("/admin/bookings/export");

  // Fetch confirmed bookings for the date range
  let query = supabase
    .from("bookings")
    .select(
      "id, date, start_time, end_time, total_price_cents, status, confirmation_code, notes, customer_id, bay_id, is_guest, guest_name, guest_email, guest_phone"
    )
    .eq("org_id", org.id)
    .eq("status", "confirmed")
    .gte("date", fromDate)
    .lte("date", toDate!)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });

  if (params.bay) {
    query = query.eq("bay_id", params.bay);
  }

  const { data: bookings } = await query;

  // Load bays
  const { data: bays } = await supabase
    .from("bays")
    .select("id, name")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");

  const bayMap: Record<string, string> = {};
  if (bays) {
    for (const b of bays) {
      bayMap[b.id] = b.name;
    }
  }

  // Look up customer profiles
  const customerIds = [
    ...new Set(bookings?.map((b) => b.customer_id).filter(Boolean) ?? []),
  ];
  const customerMap: Record<
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

  // Group bookings by date
  const bookingsByDate: Record<string, NonNullable<typeof bookings>> = {};
  for (const b of bookings ?? []) {
    if (!bookingsByDate[b.date]) {
      bookingsByDate[b.date] = [];
    }
    bookingsByDate[b.date].push(b);
  }

  const dates = Object.keys(bookingsByDate).sort();

  // Get the bay name being filtered (if any)
  const filteredBayName = params.bay ? bayMap[params.bay] : null;

  return (
    <>
      {/* Print-specific styles: hide admin layout chrome, optimize for paper */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              /* Hide admin sidebar, header, backdrop */
              aside { display: none !important; }
              header { display: none !important; }
              /* Reset the content wrapper margin */
              .lg\\:ml-\\[280px\\] { margin-left: 0 !important; }
              /* Hide the print controls bar */
              .print-controls-bar { display: none !important; }
              /* Remove page padding from admin main */
              main { padding: 0 !important; }
              /* Reset background */
              body, .min-h-screen { background: white !important; }
              /* Page settings */
              @page { margin: 0.5in 0.6in; size: letter; }
              /* Page breaks between dates */
              .print-date-page, .print-timeline-page { break-after: page; }
              .print-date-page:last-child, .print-timeline-page:last-child { break-after: auto; }
              /* Ensure zebra stripes print */
              .print-row-even { background: #f9fafb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .print-guest-badge { background: #fef3c7 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              /* Timeline booking blocks */
              .print-booking-block { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .print-timeline-hour-stripe:nth-child(even) { background: #f9fafb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              /* Landscape for timeline */
              .print-timeline-page { break-inside: avoid; }
            }
          `,
        }}
      />

      {/* Controls bar (hidden in print) */}
      <PrintPageClient />

      {/* Print content */}
      <div className="-mx-4 -mt-4 md:-mx-6 md:-mt-6">
        {dates.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">
              No confirmed bookings found for the selected dates.
            </p>
          </div>
        ) : isTimeline ? (
          /* ============ TIMELINE GRID LAYOUT ============ */
          dates.map((date) => {
            const dayBookings = bookingsByDate[date];
            const totalRevenue = dayBookings.reduce(
              (sum, b) => sum + b.total_price_cents,
              0
            );
            const dateFormatted = new Date(
              date + "T12:00:00"
            ).toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            });

            // Determine which bays to show columns for
            const displayBays = params.bay
              ? (bays ?? []).filter((b) => b.id === params.bay)
              : (bays ?? []);

            // Calculate hour range from bookings
            let startHour = 8;
            let endHour = 18;
            if (dayBookings.length > 0) {
              const hours = dayBookings.flatMap((b) => [
                getHourInTimezone(b.start_time, org.timezone),
                getHourInTimezone(b.end_time, org.timezone),
              ]);
              startHour = Math.floor(Math.min(...hours));
              endHour = Math.ceil(Math.max(...hours));
              // Ensure at least 2 hour range
              if (endHour - startHour < 2) endHour = startHour + 2;
            }
            const totalHours = endHour - startHour;
            const gridHeight = totalHours * ROW_HEIGHT;

            // Group bookings by bay
            const bookingsByBay: Record<string, typeof dayBookings> = {};
            for (const b of dayBookings) {
              if (!bookingsByBay[b.bay_id]) bookingsByBay[b.bay_id] = [];
              bookingsByBay[b.bay_id].push(b);
            }

            return (
              <div
                key={date}
                className="print-timeline-page bg-white p-6 sm:p-8 dark:bg-gray-950"
              >
                {/* Header */}
                <div className="mb-4 border-b-2 border-gray-900 pb-3 dark:border-white">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                    {org.name}
                  </h2>
                  <p className="text-base font-medium text-gray-600 dark:text-gray-300">
                    {dateFormatted}
                  </p>
                  <div className="mt-1.5 flex gap-6 text-sm text-gray-500 dark:text-gray-400">
                    <span>
                      Bookings:{" "}
                      <strong className="text-gray-900 dark:text-white">
                        {dayBookings.length}
                      </strong>
                    </span>
                    <span>
                      Revenue:{" "}
                      <strong className="text-gray-900 dark:text-white">
                        ${(totalRevenue / 100).toFixed(2)}
                      </strong>
                    </span>
                  </div>
                  {filteredBayName && (
                    <p className="mt-1 text-xs text-gray-400">
                      Filtered to: {filteredBayName}
                    </p>
                  )}
                </div>

                {/* Timeline Grid */}
                <div
                  className="relative border border-gray-200 dark:border-gray-700"
                  style={{
                    display: "grid",
                    gridTemplateColumns: `50px repeat(${displayBays.length}, 1fr)`,
                  }}
                >
                  {/* Bay header row */}
                  <div className="border-b-2 border-gray-300 bg-gray-50 px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-500" />
                  {displayBays.map((bay) => (
                    <div
                      key={bay.id}
                      className="border-b-2 border-l border-gray-300 bg-gray-50 px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300"
                    >
                      {bay.name}
                    </div>
                  ))}

                  {/* Hour labels column + bay columns */}
                  <div
                    className="relative border-r border-gray-200 dark:border-gray-700"
                    style={{ height: gridHeight }}
                  >
                    {Array.from({ length: totalHours }, (_, i) => {
                      const hour = startHour + i;
                      return (
                        <div
                          key={hour}
                          className="absolute right-0 left-0 border-b border-dashed border-gray-200 dark:border-gray-800"
                          style={{
                            top: i * ROW_HEIGHT,
                            height: ROW_HEIGHT,
                          }}
                        >
                          <span className="absolute -top-[7px] left-1 text-[10px] font-medium text-gray-400 dark:text-gray-500">
                            {formatHourLabel(hour)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Bay columns with bookings */}
                  {displayBays.map((bay) => {
                    const bayBookings = bookingsByBay[bay.id] ?? [];
                    return (
                      <div
                        key={bay.id}
                        className="relative border-l border-gray-200 dark:border-gray-700"
                        style={{ height: gridHeight }}
                      >
                        {/* Hour gridlines */}
                        {Array.from({ length: totalHours }, (_, i) => (
                          <div
                            key={i}
                            className={`absolute right-0 left-0 border-b border-dashed border-gray-100 dark:border-gray-800 ${
                              i % 2 === 1
                                ? "print-timeline-hour-stripe bg-gray-50/50"
                                : ""
                            }`}
                            style={{
                              top: i * ROW_HEIGHT,
                              height: ROW_HEIGHT,
                            }}
                          />
                        ))}

                        {/* Booking blocks */}
                        {bayBookings.map((booking) => {
                          const bStart = getHourInTimezone(
                            booking.start_time,
                            org.timezone
                          );
                          const bEnd = getHourInTimezone(
                            booking.end_time,
                            org.timezone
                          );
                          const topPct =
                            ((bStart - startHour) / totalHours) * 100;
                          const heightPct =
                            ((bEnd - bStart) / totalHours) * 100;

                          let name: string;
                          let isGuest = false;
                          if (booking.is_guest) {
                            name = booking.guest_name || "Guest";
                            isGuest = true;
                          } else {
                            const c = booking.customer_id
                              ? customerMap[booking.customer_id]
                              : null;
                            name = c?.full_name || c?.email || "Unknown";
                          }

                          const startTime = formatTimeInZone(
                            booking.start_time,
                            org.timezone
                          );
                          const endTime = formatTimeInZone(
                            booking.end_time,
                            org.timezone
                          );

                          return (
                            <div
                              key={booking.id}
                              className={`print-booking-block absolute right-1 left-1 overflow-hidden rounded ${
                                isGuest
                                  ? "border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
                                  : "border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"
                              }`}
                              style={{
                                top: `${topPct}%`,
                                height: `${heightPct}%`,
                                padding: "2px 4px",
                                minHeight: "20px",
                              }}
                            >
                              <div className="flex items-center gap-1">
                                <p
                                  className={`truncate text-[9px] font-bold leading-tight ${
                                    isGuest
                                      ? "text-amber-900 dark:text-amber-300"
                                      : "text-blue-900 dark:text-blue-300"
                                  }`}
                                >
                                  {name}
                                </p>
                                {isGuest && (
                                  <span className="print-guest-badge shrink-0 rounded bg-amber-200 px-1 text-[7px] font-bold text-amber-800 dark:bg-amber-800 dark:text-amber-200">
                                    G
                                  </span>
                                )}
                              </div>
                              <p className="truncate text-[8px] leading-tight text-gray-600 dark:text-gray-400">
                                {startTime} – {endTime}
                              </p>
                              <p className="truncate font-mono text-[8px] leading-tight text-gray-400 dark:text-gray-500">
                                {booking.confirmation_code}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        ) : (
          /* ============ TABLE LAYOUT ============ */
          dates.map((date) => {
            const dayBookings = bookingsByDate[date];
            const totalRevenue = dayBookings.reduce(
              (sum, b) => sum + b.total_price_cents,
              0
            );
            const dateFormatted = new Date(
              date + "T12:00:00"
            ).toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            });

            return (
              <div
                key={date}
                className="print-date-page bg-white p-6 sm:p-8 dark:bg-gray-950"
              >
                {/* Header */}
                <div className="mb-5 border-b-2 border-gray-900 pb-4 dark:border-white">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                    {org.name}
                  </h2>
                  <p className="text-base font-medium text-gray-600 dark:text-gray-300">
                    {dateFormatted}
                  </p>
                  <div className="mt-2 flex gap-6 text-sm text-gray-500 dark:text-gray-400">
                    <span>
                      Confirmed Bookings:{" "}
                      <strong className="text-gray-900 dark:text-white">
                        {dayBookings.length}
                      </strong>
                    </span>
                    <span>
                      Total Revenue:{" "}
                      <strong className="text-gray-900 dark:text-white">
                        ${(totalRevenue / 100).toFixed(2)}
                      </strong>
                    </span>
                  </div>
                  {filteredBayName && (
                    <p className="mt-1 text-xs text-gray-400">
                      Filtered to: {filteredBayName}
                    </p>
                  )}
                </div>

                {/* Table */}
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border-b-2 border-gray-200 px-2.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        Time
                      </th>
                      <th className="border-b-2 border-gray-200 px-2.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        Bay
                      </th>
                      <th className="border-b-2 border-gray-200 px-2.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        Customer
                      </th>
                      <th className="border-b-2 border-gray-200 px-2.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        Code
                      </th>
                      <th className="border-b-2 border-gray-200 px-2.5 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        Price
                      </th>
                      <th className="border-b-2 border-gray-200 px-2.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        Notes
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayBookings.map((booking, idx) => {
                      let name: string;
                      let email: string | null = null;
                      let isGuest = false;

                      if (booking.is_guest) {
                        name = booking.guest_name || "Guest";
                        email = booking.guest_email;
                        isGuest = true;
                      } else {
                        const c = booking.customer_id
                          ? customerMap[booking.customer_id]
                          : null;
                        name = c?.full_name || c?.email || "Unknown";
                        email = c?.full_name && c?.email ? c.email : null;
                      }

                      const startTime = formatTimeInZone(
                        booking.start_time,
                        org.timezone
                      );
                      const endTime = formatTimeInZone(
                        booking.end_time,
                        org.timezone
                      );

                      return (
                        <tr
                          key={booking.id}
                          className={`border-b border-gray-100 dark:border-gray-800 ${
                            idx % 2 === 1
                              ? "print-row-even bg-gray-50 dark:bg-gray-900/50"
                              : ""
                          }`}
                        >
                          <td className="whitespace-nowrap px-2.5 py-2 text-gray-900 dark:text-white">
                            {startTime} – {endTime}
                          </td>
                          <td className="px-2.5 py-2 text-gray-900 dark:text-white">
                            {bayMap[booking.bay_id] ?? "Unknown"}
                          </td>
                          <td className="px-2.5 py-2">
                            <span className="text-gray-900 dark:text-white">
                              {name}
                            </span>
                            {isGuest && (
                              <span className="print-guest-badge ml-1.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                                Guest
                              </span>
                            )}
                            {email && (
                              <div className="text-xs text-gray-400">
                                {email}
                              </div>
                            )}
                          </td>
                          <td className="px-2.5 py-2 font-mono text-xs text-gray-600 dark:text-gray-400">
                            {booking.confirmation_code}
                          </td>
                          <td className="px-2.5 py-2 text-right font-semibold text-gray-900 dark:text-white">
                            ${(booking.total_price_cents / 100).toFixed(2)}
                          </td>
                          <td className="px-2.5 py-2 text-xs text-gray-500 dark:text-gray-400">
                            {booking.notes || "\u2014"}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Total row */}
                    <tr>
                      <td
                        colSpan={4}
                        className="border-t-2 border-gray-900 px-2.5 pt-2.5 text-right text-sm font-bold text-gray-900 dark:border-white dark:text-white"
                      >
                        Total
                      </td>
                      <td className="border-t-2 border-gray-900 px-2.5 pt-2.5 text-right text-sm font-bold text-gray-900 dark:border-white dark:text-white">
                        ${(totalRevenue / 100).toFixed(2)}
                      </td>
                      <td className="border-t-2 border-gray-900 dark:border-white"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
