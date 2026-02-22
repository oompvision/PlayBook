import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";

export default async function AdminUsersPage() {
  const supabase = await createClient();

  const { data: admins } = await supabase
    .from("profiles")
    .select("*, organizations(name, slug)")
    .in("role", ["admin", "super_admin"])
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Admin Users</h1>
      <p className="mt-2 text-muted-foreground">
        View all admin users across the platform.
      </p>

      <div className="mt-8 rounded-lg border">
        {!admins || admins.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            No admin users found.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-sm text-muted-foreground">
                <th className="p-4 font-medium">Name</th>
                <th className="p-4 font-medium">Email</th>
                <th className="p-4 font-medium">Role</th>
                <th className="p-4 font-medium">Organization</th>
                <th className="p-4 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => {
                const org = admin.organizations as {
                  name: string;
                  slug: string;
                } | null;
                return (
                  <tr key={admin.id} className="border-b last:border-0">
                    <td className="p-4 font-medium">
                      {admin.full_name || "—"}
                    </td>
                    <td className="p-4 text-sm">{admin.email}</td>
                    <td className="p-4">
                      <Badge
                        variant={
                          admin.role === "super_admin"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {admin.role === "super_admin"
                          ? "Super Admin"
                          : "Admin"}
                      </Badge>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">
                      {org ? org.name : "Platform"}
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">
                      {new Date(admin.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
