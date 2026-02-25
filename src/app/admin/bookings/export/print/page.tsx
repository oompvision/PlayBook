import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { formatTimeInZone } from "@/lib/utils";
import { PrintPageClient } from "./print-client";

export default async function PrintPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; bay?: string }>;
}) {
  const params = await searchParams;
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
              .print-date-page { break-after: page; }
              .print-date-page:last-child { break-after: auto; }
              /* Ensure zebra stripes print */
              .print-row-even { background: #f9fafb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .print-guest-badge { background: #fef3c7 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
        ) : (
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
