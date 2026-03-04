import { ensureCustomerOrg } from "@/lib/auth";
import { getFacilitySlug } from "@/lib/facility";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CustomerNotificationsList } from "./notifications-list";

export default async function CustomerNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, logo_url")
    .eq("slug", slug)
    .single();
  if (!org) redirect("/");

  const auth = await ensureCustomerOrg(org.id);
  if (!auth) redirect(`/auth/login?redirect=/notifications`);

  const params = await searchParams;
  const filter = params.filter ?? "all";

  let query = supabase
    .from("notifications")
    .select("id, type, title, message, link, is_read, created_at")
    .eq("recipient_id", auth.profile.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (filter === "unread") {
    query = query.eq("is_read", false);
  }

  const { data: notifications } = await query;

  return (
    <div className="flex-1 p-8">
      <div className="mx-auto max-w-2xl">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="mt-2 text-muted-foreground">
            View your booking updates, reminders, and more.
          </p>
        </div>

        {/* Filter tabs */}
        <div className="mt-6 flex gap-1 rounded-lg bg-gray-100 p-1">
          <a
            href="/notifications"
            className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors ${
              filter === "all"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            All
          </a>
          <a
            href="/notifications?filter=unread"
            className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors ${
              filter === "unread"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Unread
          </a>
        </div>

        <div className="mt-4">
          <CustomerNotificationsList notifications={notifications ?? []} />
        </div>
      </div>
    </div>
  );
}
