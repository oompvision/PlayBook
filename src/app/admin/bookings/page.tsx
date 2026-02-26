import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTodayInTimezone } from "@/lib/utils";
import { DailySchedule } from "@/components/daily-schedule";
import { AdminBookingsList } from "@/components/admin/bookings-list";
import {
  CalendarDays,
  List,
  Search,
  SlidersHorizontal,
  UserPlus,
  X,
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

export default async function BookingsListPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    from?: string;
    to?: string;
    status?: string;
    bay?: string;
    q?: string;
    cancelled?: string;
    guest_booked?: string;
    codes?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  await requireAdmin(org.id);

  const supabase = await createClient();
  const activeView = params.view === "daily" ? "daily" : "list";

  // Load bays for filter dropdown + daily view columns
  const { data: bays } = await supabase
    .from("bays")
    .select("id, name")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");

  // Build bookings query (includes guest fields)
  let query = supabase
    .from("bookings")
    .select(
      "id, date, start_time, end_time, total_price_cents, status, confirmation_code, notes, created_at, customer_id, bay_id, is_guest, guest_name, guest_email, guest_phone"
    )
    .eq("org_id", org.id)
    .order("date", { ascending: false })
    .order("start_time", { ascending: false });

  if (activeView === "list") {
    if (params.from) {
      query = query.gte("date", params.from);
    }
    if (params.to) {
      query = query.lte("date", params.to);
    }
    if (params.status && params.status !== "all") {
      query = query.eq("status", params.status);
    }
    if (params.bay) {
      query = query.eq("bay_id", params.bay);
    }
  }

  const { data: bookings, error: bookingsError } = await query;

  if (bookingsError) {
    console.error("Failed to load bookings:", bookingsError.message);
  }

  // Look up customer names and bay names (filter out null customer_ids from guest bookings)
  const customerIds = [
    ...new Set(bookings?.map((b) => b.customer_id).filter(Boolean) ?? []),
  ];
  let customerMap: Record<string, { full_name: string | null; email: string }> =
    {};
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

  const bayMap: Record<string, string> = {};
  if (bays) {
    for (const b of bays) {
      bayMap[b.id] = b.name;
    }
  }

  // Filter by customer search (name or email) — client-side since we join manually
  const search = params.q?.trim().toLowerCase();
  let filtered = bookings ?? [];
  if (search) {
    filtered = filtered.filter((b) => {
      if (b.is_guest) {
        return (
          (b.guest_name && b.guest_name.toLowerCase().includes(search)) ||
          (b.guest_email && b.guest_email.toLowerCase().includes(search))
        );
      }
      const c = b.customer_id ? customerMap[b.customer_id] : null;
      if (!c) return false;
      return (
        c.email.toLowerCase().includes(search) ||
        (c.full_name && c.full_name.toLowerCase().includes(search))
      );
    });
  }

  async function cancelBooking(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();
    const bookingId = formData.get("booking_id") as string;

    const { error } = await supabase.rpc("cancel_booking", {
      p_booking_id: bookingId,
    });

    if (error) {
      redirect(
        `/admin/bookings?error=${encodeURIComponent(error.message)}`
      );
    }
    revalidatePath("/admin/bookings");
    redirect("/admin/bookings?cancelled=true");
  }

  const today = getTodayInTimezone(org.timezone);

  // Check if any filters are active
  const hasActiveFilters = params.from || params.to || (params.status && params.status !== "all") || params.bay || params.q;

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Bookings
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            View, filter, and manage all bookings.
          </p>
        </div>
        <a
          href="/admin/bookings/guest"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
        >
          <UserPlus className="h-4 w-4" />
          Guest Booking
        </a>
      </div>

      {/* Alerts */}
      {bookingsError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          Failed to load bookings: {bookingsError.message}
        </div>
      )}
      {params.error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {params.error}
        </div>
      )}
      {params.cancelled && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
          Booking cancelled successfully.
        </div>
      )}
      {params.guest_booked && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
          Guest booking created successfully.{params.codes ? ` Confirmation: ${params.codes}` : ""}
        </div>
      )}

      {/* View Tabs - TailAdmin segmented style */}
      <div className="mb-6 flex items-center justify-between">
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900">
          <a
            href="/admin/bookings?view=list"
            className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeView === "list"
                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            <List className="h-4 w-4" />
            List View
          </a>
          <a
            href="/admin/bookings?view=daily"
            className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeView === "daily"
                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            <CalendarDays className="h-4 w-4" />
            Daily View
          </a>
        </div>

        {activeView === "list" && (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {activeView === "list" ? (
        <>
          {/* Inline Filter Bar */}
          <form className="mb-6">
            <input type="hidden" name="view" value="list" />
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  From
                </label>
                <input
                  type="date"
                  name="from"
                  defaultValue={params.from ?? ""}
                  className="h-10 w-38 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  To
                </label>
                <input
                  type="date"
                  name="to"
                  defaultValue={params.to ?? ""}
                  className="h-10 w-38 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Status
                </label>
                <select
                  name="status"
                  defaultValue={params.status ?? "all"}
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 pr-8 text-sm text-gray-800 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                >
                  <option value="all">All statuses</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Facility
                </label>
                <select
                  name="bay"
                  defaultValue={params.bay ?? ""}
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 pr-8 text-sm text-gray-800 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                >
                  <option value="">All facilities</option>
                  {bays?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Customer
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    name="q"
                    placeholder="Name or email..."
                    defaultValue={params.q ?? ""}
                    className="h-10 w-44 rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-800 shadow-sm transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filter
              </button>
              {hasActiveFilters && (
                <a href="/admin/bookings?view=list">
                  <button
                    type="button"
                    className="inline-flex h-10 items-center gap-1 rounded-lg px-3 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </button>
                </a>
              )}
            </div>
          </form>

          <AdminBookingsList
            bookings={filtered}
            bayMap={bayMap}
            customerMap={customerMap}
            timezone={org.timezone}
            cancelAction={cancelBooking}
          />
        </>
      ) : (
        /* Daily View - wrapped in TailAdmin card */
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="p-4 sm:p-6">
            <DailySchedule
              bookings={bookings ?? []}
              bays={bays ?? []}
              customerMap={customerMap}
              timezone={org.timezone}
              initialDate={today}
              cancelAction={cancelBooking}
            />
          </div>
        </div>
      )}
    </div>
  );
}
