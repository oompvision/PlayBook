import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OrgHeader } from "@/components/org-header";
import { AuthModal } from "@/components/auth-modal";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { CustomerAvatarMenu } from "@/components/customer-avatar-menu";

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
    .select("id, name, slug, logo_url, membership_tiers_enabled, events_enabled")
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

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <OrgHeader name={org.name} logoUrl={org.logo_url} />
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
                <Link href="/my-bookings">
                  <Button variant="ghost" size="sm">
                    My Bookings
                  </Button>
                </Link>
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
