import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";

const superAdminNav = [
  { label: "Dashboard", href: "/super-admin" },
  { label: "Organizations", href: "/super-admin/orgs" },
  { label: "Admin Users", href: "/super-admin/admins" },
  { label: "Settings", href: "/super-admin/settings" },
];

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireSuperAdmin();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r bg-muted/40 p-6">
        <div className="mb-8">
          <h2 className="text-lg font-semibold">PlayBook</h2>
          <p className="text-xs text-muted-foreground">Super Admin</p>
        </div>
        <nav className="flex-1 space-y-1">
          {superAdminNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t pt-4">
          <p className="truncate text-sm font-medium">{profile.email}</p>
          <p className="text-xs text-muted-foreground">Super Admin</p>
          <SignOutButton />
        </div>
      </aside>
      {/* Main content */}
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
