import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { NotificationsList } from "./notifications-list";

export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const auth = await getAuthUser();
  if (!auth) redirect("/auth/login");

  const params = await searchParams;
  const filter = params.filter ?? "all";

  const supabase = await createClient();

  let query = supabase
    .from("notifications")
    .select("id, type, title, message, link, is_read, created_at")
    .eq("recipient_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (filter === "unread") {
    query = query.eq("is_read", false);
  }

  const { data: notifications } = await query;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          View and manage your notifications.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        <a
          href="/admin/notifications"
          className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors ${
            filter === "all"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          All
        </a>
        <a
          href="/admin/notifications?filter=unread"
          className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors ${
            filter === "unread"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Unread
        </a>
      </div>

      <NotificationsList
        notifications={notifications ?? []}
        userId={auth.user.id}
      />
    </div>
  );
}
