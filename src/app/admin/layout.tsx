import { getFacilitySlug } from "@/lib/facility";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SidebarProvider } from "@/context/sidebar-context";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminHeader } from "@/components/admin/admin-header";
import { AdminBackdrop } from "@/components/admin/admin-backdrop";
import { resolveLocationId, getOrgLocations } from "@/lib/location";
import { LocationUrlSync } from "@/components/admin/location-url-sync";

export default async function AdminLayout({
  children,
  searchParams: searchParamsPromise,
}: {
  children: React.ReactNode;
  searchParams?: Promise<{ [key: string]: string | undefined }>;
}) {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  const searchParams = searchParamsPromise ? await searchParamsPromise : {};

  // Resolve slug to org — required to validate admin belongs to this org
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, scheduling_type, locations_enabled, membership_tiers_enabled")
    .eq("slug", slug)
    .single();

  if (!org) redirect("/");

  // Enforce authorization: admin must belong to this org, super_admin can enter any
  // requireAdmin redirects to /auth/login if not authenticated,
  // redirects to / if role is not admin/super_admin or org_id doesn't match
  const auth = await requireAdmin(org.id);

  // Check if admin needs to complete profile setup
  if (auth.profile.role === "admin") {
    const { count } = await supabase
      .from("admin_profiles")
      .select("id", { count: "exact", head: true })
      .eq("id", auth.profile.id);

    if (count === 0) {
      redirect("/auth/admin-setup");
    }
  }

  // Resolve location context
  const locations = org.locations_enabled
    ? await getOrgLocations(org.id)
    : [];
  const activeLocationId = await resolveLocationId(
    org.id,
    searchParams.location,
    auth.user.id
  );

  return (
    <SidebarProvider>
      <div className="min-h-screen bg-gray-50">
        <AdminSidebar slug={slug} schedulingType={org.scheduling_type} membershipEnabled={org.membership_tiers_enabled} />
        <AdminBackdrop />
        <div className="lg:ml-[280px]">
          <AdminHeader
            user={{ email: auth.user.email, fullName: auth.profile.full_name }}
            userId={auth.user.id}
            locationsEnabled={org.locations_enabled}
            locations={locations}
            activeLocationId={activeLocationId}
          />
          {org.locations_enabled && activeLocationId && (
            <LocationUrlSync activeLocationId={activeLocationId} />
          )}
          <main className="p-4 md:p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
