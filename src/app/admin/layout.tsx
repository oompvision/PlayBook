import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import Link from "next/link";

const adminNav = [
  { label: "Dashboard", href: "/admin" },
  { label: "Bays", href: "/admin/bays" },
  { label: "Schedule", href: "/admin/schedule" },
  { label: "Templates", href: "/admin/templates" },
  { label: "Bookings", href: "/admin/bookings" },
  { label: "Customers", href: "/admin/customers" },
  { label: "Revenue", href: "/admin/revenue" },
  { label: "Settings", href: "/admin/settings" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-muted/40 p-6">
        <div className="mb-8">
          <h2 className="text-lg font-semibold capitalize">
            {slug.replace(/-/g, " ")}
          </h2>
          <p className="text-xs text-muted-foreground">Admin Dashboard</p>
        </div>
        <nav className="space-y-1">
          {adminNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      {/* Main content */}
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
