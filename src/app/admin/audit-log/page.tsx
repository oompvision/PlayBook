import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  create: "Create",
  read: "Read",
  update: "Update",
  delete: "Delete",
  login: "Login",
  login_failed: "Login Failed",
  logout: "Logout",
  export: "Export",
};

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-100 text-green-800",
  read: "bg-blue-100 text-blue-800",
  update: "bg-yellow-100 text-yellow-800",
  delete: "bg-red-100 text-red-800",
  login: "bg-purple-100 text-purple-800",
  login_failed: "bg-red-100 text-red-800",
  logout: "bg-gray-100 text-gray-800",
  export: "bg-indigo-100 text-indigo-800",
};

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, timezone")
    .eq("slug", slug)
    .single();

  if (!org) redirect("/");

  const page = Math.max(1, parseInt(params.page || "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  const { data: logs, count } = await supabase
    .from("audit_logs")
    .select(
      "id, action, resource_type, resource_id, user_id, ip_address, metadata, created_at",
      { count: "exact" }
    )
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  const totalPages = Math.ceil((count || 0) / PAGE_SIZE);

  // Resolve user emails for display
  const userIds = [...new Set((logs || []).map((l) => l.user_id).filter(Boolean))];
  let userMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", userIds);
    if (profiles) {
      for (const p of profiles) {
        userMap[p.id] = p.email;
      }
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            Activity history for {org.name}. {count ?? 0} total events.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Time</th>
              <th className="px-4 py-3 text-left font-medium">Action</th>
              <th className="px-4 py-3 text-left font-medium">Resource</th>
              <th className="px-4 py-3 text-left font-medium">User</th>
              <th className="px-4 py-3 text-left font-medium">IP Address</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(!logs || logs.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No audit events recorded yet.
                </td>
              </tr>
            )}
            {(logs || []).map((log) => (
              <tr key={log.id} className="hover:bg-muted/30">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {new Date(log.created_at).toLocaleString("en-US", {
                    timeZone: org.timezone,
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      ACTION_COLORS[log.action] || "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {ACTION_LABELS[log.action] || log.action}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium capitalize">
                    {log.resource_type.replace(/_/g, " ")}
                  </span>
                  {log.resource_id && (
                    <span className="ml-1 text-muted-foreground">
                      ({log.resource_id.slice(0, 8)}...)
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {log.user_id
                    ? userMap[log.user_id] || log.user_id.slice(0, 8) + "..."
                    : "System"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {log.ip_address || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <a
                href={`/admin/audit-log?page=${page - 1}`}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Previous
              </a>
            )}
            {page < totalPages && (
              <a
                href={`/admin/audit-log?page=${page + 1}`}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Next
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
