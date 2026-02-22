import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function OrganizationsPage() {
  const supabase = await createClient();

  const { data: orgs } = await supabase
    .from("organizations")
    .select("*")
    .order("created_at", { ascending: false });

  // Get bay counts per org
  const { data: bays } = await supabase
    .from("bays")
    .select("id, org_id");

  const bayCountMap: Record<string, number> = {};
  (bays || []).forEach((b) => {
    bayCountMap[b.org_id] = (bayCountMap[b.org_id] || 0) + 1;
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
          <p className="mt-2 text-muted-foreground">
            Manage all facilities on the platform.
          </p>
        </div>
        <Link href="/super-admin/orgs/new">
          <Button>Create Organization</Button>
        </Link>
      </div>

      <div className="mt-8 rounded-lg border">
        {!orgs || orgs.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            No organizations yet.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-sm text-muted-foreground">
                <th className="p-4 font-medium">Name</th>
                <th className="p-4 font-medium">Slug</th>
                <th className="p-4 font-medium">Facilities</th>
                <th className="p-4 font-medium">Timezone</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium">Created</th>
                <th className="p-4 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
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
                  <td className="p-4 text-sm">
                    {bayCountMap[org.id] || 0}
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">
                    {org.timezone}
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
                  <td className="p-4">
                    <Link
                      href={`/super-admin/orgs/${org.id}`}
                      className="text-sm text-primary hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
