import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default async function SuperAdminDashboardPage() {
  const supabase = await createClient();

  // Fetch stats
  const [orgsResult, bookingsResult, adminsResult] = await Promise.all([
    supabase.from("organizations").select("id, name, slug, is_active, created_at"),
    supabase.from("bookings").select("id, total_price_cents, status, created_at"),
    supabase.from("profiles").select("id, email, full_name, role, created_at").eq("role", "admin"),
  ]);

  const orgs = orgsResult.data || [];
  const bookings = bookingsResult.data || [];
  const admins = adminsResult.data || [];

  const activeOrgs = orgs.filter((o) => o.is_active);
  const confirmedBookings = bookings.filter((b) => b.status === "confirmed");
  const totalRevenue = confirmedBookings.reduce(
    (sum, b) => sum + (b.total_price_cents || 0),
    0
  );

  // Recent orgs (last 5)
  const recentOrgs = [...orgs]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Platform Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        Platform-wide overview and statistics.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Organizations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{activeOrgs.length}</p>
            <p className="text-xs text-muted-foreground">
              {orgs.length} total
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Bookings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{confirmedBookings.length}</p>
            <p className="text-xs text-muted-foreground">confirmed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              ${(totalRevenue / 100).toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">all time</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Admin Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{admins.length}</p>
            <p className="text-xs text-muted-foreground">across all orgs</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent Organizations</h2>
          <Link
            href="/super-admin/orgs"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View all →
          </Link>
        </div>
        <div className="mt-4 rounded-lg border">
          {recentOrgs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No organizations yet.{" "}
              <Link
                href="/super-admin/orgs/new"
                className="text-primary hover:underline"
              >
                Create one
              </Link>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4 font-medium">Name</th>
                  <th className="p-4 font-medium">Slug</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {recentOrgs.map((org) => (
                  <tr key={org.id} className="border-b last:border-0">
                    <td className="p-4">
                      <Link
                        href={`/super-admin/orgs/${org.id}`}
                        className="font-medium hover:underline"
                      >
                        {org.name}
                      </Link>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">
                      {org.slug}
                    </td>
                    <td className="p-4">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          org.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {org.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">
                      {new Date(org.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
