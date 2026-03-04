import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { Search, Users, X, SlidersHorizontal } from "lucide-react";
import { CustomerList } from "@/components/customer-list";
import type { CustomerEntry } from "@/components/customer-profile-modal";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, locations_enabled")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function CustomerListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const search = params.q?.trim();

  // ---- Registered customers ----
  let profileQuery = supabase
    .from("profiles")
    .select("id, email, full_name, phone, role, created_at")
    .eq("org_id", org.id)
    .eq("role", "customer")
    .order("created_at", { ascending: false });

  if (search) {
    profileQuery = profileQuery.or(
      `full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
    );
  }

  const { data: customers } = await profileQuery;

  // Get booking counts per registered customer
  const customerIds = customers?.map((c) => c.id) ?? [];
  let bookingCounts: Record<string, number> = {};
  if (customerIds.length > 0) {
    const { data: counts } = await supabase
      .from("bookings")
      .select("customer_id")
      .eq("org_id", org.id)
      .in("customer_id", customerIds);

    if (counts) {
      for (const row of counts) {
        bookingCounts[row.customer_id] =
          (bookingCounts[row.customer_id] || 0) + 1;
      }
    }
  }

  // ---- Guest customers (aggregated from bookings) ----
  const { data: guestBookingsRaw } = await supabase
    .from("bookings")
    .select("guest_name, guest_email, guest_phone, created_at")
    .eq("org_id", org.id)
    .eq("is_guest", true)
    .order("created_at", { ascending: true });

  // Deduplicate guests by email (if present) or by name
  const guestDeduped = new Map<
    string,
    { name: string | null; email: string | null; phone: string | null; count: number; firstBooked: string }
  >();
  for (const gb of guestBookingsRaw ?? []) {
    const key = gb.guest_email || `name:${gb.guest_name}`;
    const existing = guestDeduped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      guestDeduped.set(key, {
        name: gb.guest_name,
        email: gb.guest_email,
        phone: gb.guest_phone,
        count: 1,
        firstBooked: gb.created_at,
      });
    }
  }

  // ---- Location preferences (for Default Location column) ----
  let locationNameMap: Record<string, string> = {}; // userId -> location name
  if (org.locations_enabled) {
    const { data: prefs } = await supabase
      .from("user_location_preferences")
      .select("user_id, default_location_id, locations:default_location_id(name)")
      .eq("org_id", org.id);

    if (prefs) {
      for (const p of prefs) {
        const locName = (p.locations as unknown as { name: string } | null)?.name;
        if (locName) locationNameMap[p.user_id] = locName;
      }
    }
  }

  // Build unified list
  const registeredEntries: CustomerEntry[] = (customers ?? []).map((c) => ({
    id: c.id,
    name: c.full_name,
    email: c.email,
    phone: c.phone,
    bookingCount: bookingCounts[c.id] || 0,
    date: c.created_at,
    isGuest: false,
  }));

  let guestEntries: CustomerEntry[] = Array.from(guestDeduped.entries()).map(
    ([key, g]) => ({
      id: `guest-${key}`,
      name: g.name,
      email: g.email,
      phone: g.phone,
      bookingCount: g.count,
      date: g.firstBooked,
      isGuest: true,
    })
  );

  // Apply search filter to guest entries (registered already filtered server-side)
  if (search) {
    const s = search.toLowerCase();
    guestEntries = guestEntries.filter(
      (g) =>
        (g.name && g.name.toLowerCase().includes(s)) ||
        (g.email && g.email.toLowerCase().includes(s)) ||
        (g.phone && g.phone.toLowerCase().includes(s))
    );
  }

  const allEntries = [...registeredEntries, ...guestEntries];
  const totalCount = (customers?.length ?? 0) + guestDeduped.size;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Customers
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            View and search registered customers and guests.
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {totalCount} total
        </span>
      </div>

      {/* Search Bar */}
      <form>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                name="q"
                placeholder="Name, email, or phone..."
                defaultValue={search ?? ""}
                className="h-10 w-72 rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-800 shadow-sm transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
              />
            </div>
          </div>
          <button
            type="submit"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Search
          </button>
          {search && (
            <a href="/admin/customers">
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

      {/* Customers Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        {allEntries.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Users className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
              {search ? "No customers match your search" : "No customers yet"}
            </p>
            {!search && (
              <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
                Customers will appear here once they register or are booked as guests.
              </p>
            )}
          </div>
        ) : (
          <CustomerList
            entries={allEntries}
            orgId={org.id}
            locationsEnabled={org.locations_enabled ?? false}
            locationNameMap={locationNameMap}
          />
        )}
      </div>
    </div>
  );
}
