import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOrgLocations } from "@/lib/location";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrgHeader } from "@/components/org-header";
import { AuthModal } from "@/components/auth-modal";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { CustomerAvatarMenu } from "@/components/customer-avatar-menu";
import { MyBookingsDropdown } from "@/components/my-bookings-dropdown";
import { HeaderLocationSwitcher } from "@/components/header-location-switcher";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const slug = await getFacilitySlug();

  if (!slug) {
    // No facility context (platform landing) — no customer header
    return <>{children}</>;
  }

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, logo_url, membership_tiers_enabled, events_enabled, locations_enabled")
    .eq("slug", slug)
    .single();

  if (!org) {
    return <>{children}</>;
  }

  const auth = await getAuthUser();

  // Check active membership status for the avatar menu
  let isActiveMember = false;
  if (auth && org.membership_tiers_enabled) {
    const { data } = await supabase.rpc("is_active_member", {
      p_org_id: org.id,
      p_user_id: auth.user.id,
    });
    isActiveMember = !!data;
  }

  // Fetch locations for header switcher (desktop)
  const locationsEnabled = org.locations_enabled ?? false;
  const locations = locationsEnabled ? await getOrgLocations(org.id) : [];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <OrgHeader name={org.name} logoUrl={org.logo_url} />
            {locationsEnabled && locations.length > 1 && (
              <div className="hidden lg:block">
                <HeaderLocationSwitcher locations={locations} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {(org.events_enabled ?? true) && (
              <Link href="/events">
                <Button variant="ghost" size="sm">
                  Events
                </Button>
              </Link>
            )}
            {auth ? (
              <>
                {/* Mobile: icon link to /my-bookings */}
                <Link
                  href="/my-bookings"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 sm:hidden"
                  aria-label="My Bookings"
                >
                  <ClipboardList className="h-5 w-5" />
                </Link>
                {/* Desktop: popover dropdown */}
                <div className="hidden sm:block">
                  <MyBookingsDropdown orgId={org.id} />
                </div>
                <NotificationBell
                  userId={auth.user.id}
                  viewAllHref="/notifications"
                />
                <CustomerAvatarMenu
                  userName={auth.profile.full_name}
                  userEmail={auth.profile.email}
                  membershipEnabled={org.membership_tiers_enabled ?? false}
                  isActiveMember={isActiveMember}
                />
              </>
            ) : (
              <AuthModal />
            )}
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
