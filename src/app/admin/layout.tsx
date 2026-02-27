import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SidebarProvider } from "@/context/sidebar-context";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminHeader } from "@/components/admin/admin-header";
import { AdminBackdrop } from "@/components/admin/admin-backdrop";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  // Check if admin needs to complete profile setup
  const auth = await getAuthUser();
  if (auth?.profile.role === "admin") {
    const supabase = await createClient();
    const { count } = await supabase
      .from("admin_profiles")
      .select("id", { count: "exact", head: true })
      .eq("id", auth.profile.id);

    if (count === 0) {
      redirect("/auth/admin-setup");
    }
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen bg-gray-50">
        <AdminSidebar slug={slug} />
        <AdminBackdrop />
        <div className="lg:ml-[280px]">
          <AdminHeader
            user={
              auth
                ? { email: auth.user.email, fullName: auth.profile.full_name }
                : undefined
            }
            userId={auth?.user.id}
          />
          <main className="p-4 md:p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
