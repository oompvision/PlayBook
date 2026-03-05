import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { Search, Crown, Users, X, SlidersHorizontal } from "lucide-react";
import { MembersList } from "@/components/admin/members-list";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, locations_enabled, membership_tiers_enabled")
    .eq("slug", slug)
    .single();
  return data;
}

export type MemberEntry = {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  defaultLocation: string | null;
  billingInterval: "monthly" | "yearly" | "admin_granted" | null;
  status: "active" | "admin_granted" | "cancelled" | "guest";
  source: string | null;
  membershipId: string | null;
  memberSince: string | null;
  registeredAt: string;
  stripeSubscriptionId: string | null;
};

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  if (!org.membership_tiers_enabled) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Members
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Membership tiers are not enabled for this organization.
          </p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center dark:border-white/[0.05] dark:bg-white/[0.03]">
          <Crown className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
            Enable membership tiers in Settings to manage members.
          </p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const service = createServiceClient();
  const search = params.q?.trim();

  // Fetch membership tier for this org
  const { data: tier } = await supabase
    .from("membership_tiers")
    .select("id, name, price_monthly_cents, price_yearly_cents")
    .eq("org_id", org.id)
    .single();

  // Fetch ALL registered customers for the org
  let profileQuery = supabase
    .from("profiles")
    .select("id, email, full_name, phone, created_at")
    .eq("org_id", org.id)
    .eq("role", "customer")
    .order("created_at", { ascending: false });

  if (search) {
    profileQuery = profileQuery.or(
      `full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
    );
  }

  const { data: customers } = await profileQuery;
  const allCustomerIds = (customers || []).map((c) => c.id);

  // Fetch memberships for all customers in this org
  const { data: memberships } = await service
    .from("user_memberships")
    .select("id, user_id, status, source, stripe_subscription_id, current_period_end, expires_at, created_at")
    .eq("org_id", org.id)
    .in("user_id", allCustomerIds);

  const membershipMap = new Map(
    (memberships || []).map((m) => [m.user_id, m])
  );

  // Fetch location preferences via service client (bypasses RLS)
  // Also fetch the org's default location as fallback for users without explicit preference
  let locationNameMap: Record<string, string> = {};
  let orgDefaultLocationName: string | null = null;

  if (org.locations_enabled) {
    // Get org's default location
    const { data: defaultLoc } = await service
      .from("locations")
      .select("id, name")
      .eq("org_id", org.id)
      .eq("is_default", true)
      .eq("is_active", true)
      .single();

    if (defaultLoc) orgDefaultLocationName = defaultLoc.name;

    if (allCustomerIds.length > 0) {
      const { data: prefs } = await service
        .from("user_location_preferences")
        .select("user_id, default_location_id, locations:default_location_id(name)")
        .eq("org_id", org.id)
        .in("user_id", allCustomerIds);

      if (prefs) {
        for (const p of prefs) {
          const locName = (p.locations as unknown as { name: string } | null)?.name;
          if (locName) locationNameMap[p.user_id] = locName;
        }
      }
    }
  }

  // Build unified list: all customers with membership status overlaid
  const entries: MemberEntry[] = (customers || []).map((c) => {
    const membership = membershipMap.get(c.id);
    const isActive = membership && (membership.status === "active" || membership.status === "admin_granted");
    let billingInterval: MemberEntry["billingInterval"] = null;

    if (membership) {
      if (membership.source === "admin") {
        billingInterval = "admin_granted";
      } else if (tier) {
        if (tier.price_monthly_cents && !tier.price_yearly_cents) {
          billingInterval = "monthly";
        } else if (!tier.price_monthly_cents && tier.price_yearly_cents) {
          billingInterval = "yearly";
        } else {
          billingInterval = "monthly";
        }
      }
    }

    // Resolve default location: explicit preference > org default
    const defaultLocation = locationNameMap[c.id] || orgDefaultLocationName;

    return {
      id: c.id,
      userId: c.id,
      name: c.full_name,
      email: c.email,
      phone: c.phone,
      defaultLocation: org.locations_enabled ? defaultLocation : null,
      billingInterval,
      status: membership
        ? (membership.status as MemberEntry["status"])
        : "guest",
      source: membership?.source || null,
      membershipId: membership?.id || null,
      memberSince: membership?.created_at || null,
      registeredAt: c.created_at,
      stripeSubscriptionId: membership?.stripe_subscription_id || null,
    };
  });

  // Stats
  const activeMemberCount = entries.filter(
    (e) => e.status === "active" || e.status === "admin_granted"
  ).length;
  const guestCount = entries.filter((e) => e.status === "guest").length;

  // Per-location stats (when multi-location enabled)
  let locationStats: { name: string; memberCount: number }[] = [];
  if (org.locations_enabled) {
    const { data: locations } = await supabase
      .from("locations")
      .select("id, name")
      .eq("org_id", org.id)
      .eq("is_active", true)
      .order("name");

    if (locations && locations.length > 0) {
      const locationMemberCounts: Record<string, number> = {};
      for (const entry of entries) {
        if ((entry.status === "active" || entry.status === "admin_granted") && entry.defaultLocation) {
          locationMemberCounts[entry.defaultLocation] =
            (locationMemberCounts[entry.defaultLocation] || 0) + 1;
        }
      }

      locationStats = locations.map((loc) => ({
        name: loc.name,
        memberCount: locationMemberCounts[loc.name] || 0,
      }));
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Members
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage membership subscribers and registered customers.
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {entries.length} total
        </span>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-amber-500" />
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Active Members
            </p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-gray-800 dark:text-white/90">
            {activeMemberCount}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-gray-400" />
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Guests
            </p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-gray-800 dark:text-white/90">
            {guestCount}
          </p>
        </div>
        {locationStats.map((loc) => (
          <div
            key={loc.name}
            className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/[0.05] dark:bg-white/[0.03]"
          >
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate">
              {loc.name}
            </p>
            <p className="mt-2 text-2xl font-semibold text-gray-800 dark:text-white/90">
              {loc.memberCount}
            </p>
            <p className="text-xs text-gray-400">members</p>
          </div>
        ))}
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
            <a href="/admin/members">
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

      {/* Members Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        {entries.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Users className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
              {search ? "No customers match your search" : "No customers yet"}
            </p>
            {!search && (
              <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
                Customers will appear here once they register.
              </p>
            )}
          </div>
        ) : (
          <MembersList
            entries={entries}
            orgId={org.id}
            locationsEnabled={org.locations_enabled ?? false}
            tierName={tier?.name || null}
          />
        )}
      </div>
    </div>
  );
}
