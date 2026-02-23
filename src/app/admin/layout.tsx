import { getFacilitySlug } from "@/lib/facility";
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

  return (
    <SidebarProvider>
      <div className="min-h-screen bg-gray-50">
        <AdminSidebar slug={slug} />
        <AdminBackdrop />
        <div className="lg:ml-[280px]">
          <AdminHeader />
          <main className="p-4 md:p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
