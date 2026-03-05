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
  status: string;
  source: string;
  createdAt: string;
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
  const search = params.q?.trim();

  // Fetch membership tier for this org
  const { data: tier } = await supabase
    .from("membership_tiers")
    .select("id, name, price_monthly_cents, price_yearly_cents")
    .eq("org_id", org.id)
    .single();

  // Fetch members with profile join
  const { data: memberships } = await supabase
    .from("user_memberships")
    .select("id, user_id, status, source, stripe_subscription_id, current_period_end, expires_at, created_at")
    .eq("org_id", org.id)
    .in("status", ["active", "admin_granted", "cancelled"]);

  const memberUserIds = (memberships || []).map((m) => m.user_id);

  // Fetch profiles for members
  let profiles: { id: string; email: string; full_name: string | null; phone: string | null }[] = [];
  if (memberUserIds.length > 0) {
    let profileQuery = supabase
      .from("profiles")
      .select("id, email, full_name, phone")
      .in("id", memberUserIds);

    if (search) {
      profileQuery = profileQuery.or(
        `full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
      );
    }

    const { data } = await profileQuery;
    profiles = data || [];
  }

  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  // Fetch location preferences for default location column
  // Use service client to bypass RLS (admin may not satisfy user_id = auth.uid() policy)
  let locationNameMap: Record<string, string> = {};
  if (org.locations_enabled && memberUserIds.length > 0) {
    const service = createServiceClient();
    const { data: prefs } = await service
      .from("user_location_preferences")
      .select("user_id, default_location_id, locations:default_location_id(name)")
      .eq("org_id", org.id)
      .in("user_id", memberUserIds);

    if (prefs) {
      for (const p of prefs) {
        const locName = (p.locations as unknown as { name: string } | null)?.name;
        if (locName) locationNameMap[p.user_id] = locName;
      }
    }
  }

  // Determine billing interval from Stripe subscription metadata or tier pricing
  // For Stripe members, we infer from price — if tier has both monthly/yearly,
  // we check subscription interval. For admin-granted, it's "admin_granted".
  const memberEntries: MemberEntry[] = (memberships || [])
    .filter((m) => profileMap.has(m.user_id))
    .map((m) => {
      const profile = profileMap.get(m.user_id)!;
      let billingInterval: MemberEntry["billingInterval"] = null;

      if (m.source === "admin") {
        billingInterval = "admin_granted";
      } else if (tier) {
        // If org only has one price, that's the interval
        if (tier.price_monthly_cents && !tier.price_yearly_cents) {
          billingInterval = "monthly";
        } else if (!tier.price_monthly_cents && tier.price_yearly_cents) {
          billingInterval = "yearly";
        } else {
          // Both available — default to monthly (Stripe webhook can refine this later)
          billingInterval = "monthly";
        }
      }

      return {
        id: m.id,
        userId: m.user_id,
        name: profile.full_name,
        email: profile.email,
        phone: profile.phone,
        defaultLocation: locationNameMap[m.user_id] || null,
        billingInterval,
        status: m.status,
        source: m.source,
        createdAt: m.created_at,
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Stats
  const activeMemberCount = memberEntries.filter(
    (m) => m.status === "active" || m.status === "admin_granted"
  ).length;

  // Total registered customers (non-members = guests)
  const { count: totalCustomerCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("org_id", org.id)
    .eq("role", "customer");

  const guestCount = (totalCustomerCount || 0) - activeMemberCount;

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
      for (const entry of memberEntries) {
        if (entry.defaultLocation) {
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
            Manage membership subscribers and granted members.
          </p>
        </div>
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
        {memberEntries.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Crown className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
              {search ? "No members match your search" : "No members yet"}
            </p>
            {!search && (
              <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
                Members will appear here once customers subscribe or are granted membership.
              </p>
            )}
          </div>
        ) : (
          <MembersList
            entries={memberEntries}
            orgId={org.id}
            locationsEnabled={org.locations_enabled ?? false}
          />
        )}
      </div>
    </div>
  );
}
