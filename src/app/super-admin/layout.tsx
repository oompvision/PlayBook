import Link from "next/link";

const superAdminNav = [
  { label: "Dashboard", href: "/super-admin" },
  { label: "Organizations", href: "/super-admin/orgs" },
  { label: "Admin Users", href: "/super-admin/admins" },
  { label: "Settings", href: "/super-admin/settings" },
];

export default function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-muted/40 p-6">
        <div className="mb-8">
          <h2 className="text-lg font-semibold">PlayBook</h2>
          <p className="text-xs text-muted-foreground">Super Admin</p>
        </div>
        <nav className="space-y-1">
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
      </aside>
      {/* Main content */}
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
