import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";

const superAdminNav = [
  { label: "Dashboard", href: "/super-admin" },
  { label: "Organizations", href: "/super-admin/orgs" },
  { label: "Admin Users", href: "/super-admin/admins" },
  { label: "Settings", href: "/super-admin/settings" },
];

export default async function SuperAdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not logged in at all → send to login
  if (!user) {
    redirect("/auth/login?role=super_admin&redirect=/super-admin");
  }

  // Use RPC to bypass RLS — the server already verified auth via getUser()
  const { data: profile } = await supabase.rpc("get_my_profile");

  // Authenticated but no profile (or not super_admin) → send to setup
  if (!profile || (profile as Profile).role !== "super_admin") {
    redirect("/super-admin/setup");
  }

  const auth = { user: { id: user.id, email: user.email! }, profile: profile as Profile };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r bg-muted/40 p-6">
        <div className="mb-8">
          <Image
            src="/logos/ezbooker-logo-light.svg"
            alt="EZ Booker"
            width={160}
            height={36}
            priority
          />
          <p className="mt-1 text-xs text-muted-foreground">Super Admin</p>
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
          <p className="truncate text-sm font-medium">{auth.profile.email}</p>
          <p className="text-xs text-muted-foreground">Super Admin</p>
          <SignOutButton />
        </div>
      </aside>
      {/* Main content */}
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
