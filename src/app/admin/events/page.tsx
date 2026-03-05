import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { resolveLocationId } from "@/lib/location";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  CalendarDays,
  CheckCircle2,
  Users,
  Copy,
  Pencil,
  Trash2,
  Eye,
  Send,
  XCircle,
  LayoutTemplate,
} from "lucide-react";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    location?: string;
    status?: string;
  }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const locationId = await resolveLocationId(org.id, params.location);

  // Fetch events with registration counts
  const eventsQuery = supabase
    .from("events")
    .select(`
      *,
      event_bays (
        bay_id,
        bays:bay_id (name)
      )
    `)
    .eq("org_id", org.id)
    .order("start_time", { ascending: false });

  if (locationId) eventsQuery.eq("location_id", locationId);
  if (params.status && params.status !== "all") {
    eventsQuery.eq("status", params.status);
  }

  const { data: events } = await eventsQuery;

  // Get registration counts for all events
  const eventIds = events?.map((e) => e.id) ?? [];
  let regCounts: Record<string, number> = {};
  if (eventIds.length > 0) {
    const { data: regs } = await supabase
      .from("event_registrations")
      .select("event_id")
      .in("event_id", eventIds)
      .in("status", ["confirmed", "pending_payment"]);

    if (regs) {
      regCounts = regs.reduce(
        (acc, r) => {
          acc[r.event_id] = (acc[r.event_id] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
    }
  }

  async function deleteEvent(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `?location=${loc}` : "";
    await supabase.from("events").delete().eq("id", id);
    revalidatePath("/admin/events");
    redirect(`/admin/events${locParam}`);
  }

  async function duplicateEvent(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `?location=${loc}` : "";

    // Fetch original event
    const { data: original } = await supabase
      .from("events")
      .select("*, event_bays(bay_id)")
      .eq("id", id)
      .single();

    if (!original) {
      redirect(`/admin/events?error=Event+not+found${locParam ? `&${locParam.slice(1)}` : ""}`);
    }

    // Get the current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/auth/login");

    // Create duplicate as draft
    const { data: newEvent, error } = await supabase
      .from("events")
      .insert({
        org_id: original.org_id,
        location_id: original.location_id,
        name: `${original.name} (Copy)`,
        description: original.description,
        start_time: original.start_time,
        end_time: original.end_time,
        capacity: original.capacity,
        price_cents: original.price_cents,
        members_only: original.members_only,
        member_enrollment_days_before: original.member_enrollment_days_before,
        guest_enrollment_days_before: original.guest_enrollment_days_before,
        waitlist_promotion_hours: original.waitlist_promotion_hours,
        status: "draft",
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !newEvent) {
      redirect(
        `/admin/events?error=${encodeURIComponent(error?.message || "Failed to duplicate")}${locParam ? `&${locParam.slice(1)}` : ""}`
      );
    }

    // Copy bay assignments
    if (original.event_bays?.length > 0) {
      await supabase.from("event_bays").insert(
        original.event_bays.map((eb: { bay_id: string }) => ({
          event_id: newEvent.id,
          bay_id: eb.bay_id,
        }))
      );
    }

    revalidatePath("/admin/events");
    redirect(`/admin/events/${newEvent.id}/edit${locParam}`);
  }

  async function publishEvent(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";
    const cancelConflicts = formData.get("cancel_conflicts") === "true";

    const { data, error } = await supabase.rpc("publish_event", {
      p_event_id: id,
      p_cancel_conflicting_bookings: cancelConflicts,
    });

    if (error) {
      redirect(
        `/admin/events?error=${encodeURIComponent(error.message)}${locParam}`
      );
    }

    revalidatePath("/admin/events");
    redirect(`/admin/events?saved=true${locParam}`);
  }

  async function cancelEvent(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";

    const { error } = await supabase.rpc("cancel_event", {
      p_event_id: id,
    });

    if (error) {
      redirect(
        `/admin/events?error=${encodeURIComponent(error.message)}${locParam}`
      );
    }

    revalidatePath("/admin/events");
    redirect(`/admin/events?saved=true${locParam}`);
  }

  const statusFilter = params.status || "all";
  const locParam = locationId ? `&location=${locationId}` : "";

  const formatTime = (isoString: string) => {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: org.timezone || "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(isoString));
  };

  const formatDate = (isoString: string) => {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: org.timezone || "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(isoString));
  };

  const statusBadgeClass = (status: string) => {
    switch (status) {
      case "published":
        return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
      case "draft":
        return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
      case "cancelled":
        return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
      case "completed":
        return "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";
      default:
        return "bg-gray-100 text-gray-500";
    }
  };

  const totalEvents = events?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Events
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Create and manage open-enrollment events — clinics, group sessions, and
            more.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/events/templates${locationId ? `?location=${locationId}` : ""}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <LayoutTemplate className="h-4 w-4" />
            Templates
          </Link>
          <Link
            href={`/admin/events/create${locationId ? `?location=${locationId}` : ""}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Create Event
          </Link>
        </div>
      </div>

      {/* Alerts */}
      {params.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {params.error}
        </div>
      )}
      {params.saved && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Event saved successfully.
        </div>
      )}

      {/* Status Filter */}
      <div className="flex items-center gap-2">
        {["all", "draft", "published", "cancelled", "completed"].map((s) => (
          <Link
            key={s}
            href={`/admin/events?status=${s}${locParam}`}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
              statusFilter === s
                ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            }`}
          >
            {s}
          </Link>
        ))}
        <span className="ml-auto text-xs text-gray-400">
          {totalEvents} event{totalEvents !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Events List */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        {!events || events.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <CalendarDays className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
              No events yet
            </p>
            <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
              Create your first event to start accepting registrations.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-white/[0.05]">
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Event
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Date &amp; Time
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Facilities
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Spots
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Price
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        Status
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                    {events.map((event) => {
                      const registered = regCounts[event.id] || 0;
                      const spotsLeft = event.capacity - registered;
                      const bayNames = event.event_bays
                        ?.map((eb: { bays: { name: string } | null }) => eb.bays?.name)
                        .filter(Boolean)
                        .join(", ");

                      return (
                        <tr
                          key={event.id}
                          className="transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]"
                        >
                          <td className="px-6 py-4">
                            <div>
                              <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                                {event.name}
                              </p>
                              {event.members_only && (
                                <span className="mt-0.5 inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                                  Members Only
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-gray-800 dark:text-white/90">
                              {formatDate(event.start_time)}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {formatTime(event.start_time)} –{" "}
                              {formatTime(event.end_time)}
                            </p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {bayNames || "—"}
                            </p>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5 text-gray-400" />
                              <span className="text-sm text-gray-800 dark:text-white/90">
                                {registered}/{event.capacity}
                              </span>
                              {spotsLeft === 0 && (
                                <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400">
                                  Full
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-sm font-semibold text-gray-800 dark:text-white/90">
                              {event.price_cents === 0
                                ? "Free"
                                : `$${(event.price_cents / 100).toFixed(2)}`}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(event.status)}`}
                            >
                              {event.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Link
                                href={`/admin/events/${event.id}${locationId ? `?location=${locationId}` : ""}`}
                                className="rounded-lg border border-gray-300 bg-white p-2 text-gray-500 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800"
                                title="View Details"
                              >
                                <Eye className="h-4 w-4" />
                              </Link>
                              {event.status === "draft" && (
                                <form action={publishEvent}>
                                  <input type="hidden" name="id" value={event.id} />
                                  {locationId && (
                                    <input type="hidden" name="location" value={locationId} />
                                  )}
                                  <button
                                    type="submit"
                                    className="rounded-lg border border-green-300 bg-white p-2 text-green-600 shadow-sm transition-colors hover:bg-green-50 dark:border-green-700 dark:bg-transparent dark:text-green-400 dark:hover:bg-green-950/30"
                                    title="Publish"
                                  >
                                    <Send className="h-4 w-4" />
                                  </button>
                                </form>
                              )}
                              <Link
                                href={`/admin/events/${event.id}/edit${locationId ? `?location=${locationId}` : ""}`}
                                className="rounded-lg border border-gray-300 bg-white p-2 text-gray-500 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800"
                                title="Edit"
                              >
                                <Pencil className="h-4 w-4" />
                              </Link>
                              <form action={duplicateEvent}>
                                <input type="hidden" name="id" value={event.id} />
                                {locationId && (
                                  <input type="hidden" name="location" value={locationId} />
                                )}
                                <button
                                  type="submit"
                                  className="rounded-lg border border-gray-300 bg-white p-2 text-gray-500 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800"
                                  title="Duplicate"
                                >
                                  <Copy className="h-4 w-4" />
                                </button>
                              </form>
                              {event.status === "published" && (
                                <form action={cancelEvent}>
                                  <input type="hidden" name="id" value={event.id} />
                                  {locationId && (
                                    <input type="hidden" name="location" value={locationId} />
                                  )}
                                  <button
                                    type="submit"
                                    className="rounded-lg border border-gray-300 bg-white p-2 text-red-500 shadow-sm transition-colors hover:bg-red-50 dark:border-gray-700 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30"
                                    title="Cancel Event"
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </button>
                                </form>
                              )}
                              {event.status === "draft" && (
                                <form action={deleteEvent}>
                                  <input type="hidden" name="id" value={event.id} />
                                  {locationId && (
                                    <input type="hidden" name="location" value={locationId} />
                                  )}
                                  <button
                                    type="submit"
                                    className="rounded-lg border border-gray-300 bg-white p-2 text-red-500 shadow-sm transition-colors hover:bg-red-50 dark:border-gray-700 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30"
                                    title="Delete"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </form>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Card View */}
            <div className="divide-y divide-gray-100 md:hidden dark:divide-white/[0.05]">
              {events.map((event) => {
                const registered = regCounts[event.id] || 0;
                const bayNames = event.event_bays
                  ?.map((eb: { bays: { name: string } | null }) => eb.bays?.name)
                  .filter(Boolean)
                  .join(", ");

                return (
                  <div key={event.id} className="px-5 py-4">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                            {event.name}
                          </p>
                          <span
                            className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(event.status)}`}
                          >
                            {event.status}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                          {formatDate(event.start_time)} · {formatTime(event.start_time)} – {formatTime(event.end_time)}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                          {bayNames || "No facilities"} · {registered}/{event.capacity} spots ·{" "}
                          {event.price_cents === 0 ? "Free" : `$${(event.price_cents / 100).toFixed(2)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {event.status === "draft" && (
                          <form action={publishEvent}>
                            <input type="hidden" name="id" value={event.id} />
                            {locationId && (
                              <input type="hidden" name="location" value={locationId} />
                            )}
                            <button
                              type="submit"
                              className="rounded-lg p-1.5 text-green-600 transition-colors hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/30"
                              title="Publish"
                            >
                              <Send className="h-4 w-4" />
                            </button>
                          </form>
                        )}
                        <Link
                          href={`/admin/events/${event.id}/edit${locationId ? `?location=${locationId}` : ""}`}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <Pencil className="h-4 w-4" />
                        </Link>
                        <form action={duplicateEvent}>
                          <input type="hidden" name="id" value={event.id} />
                          {locationId && (
                            <input type="hidden" name="location" value={locationId} />
                          )}
                          <button
                            type="submit"
                            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                        </form>
                        {event.status === "published" && (
                          <form action={cancelEvent}>
                            <input type="hidden" name="id" value={event.id} />
                            {locationId && (
                              <input type="hidden" name="location" value={locationId} />
                            )}
                            <button
                              type="submit"
                              className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
                              title="Cancel Event"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </form>
                        )}
                        {event.status === "draft" && (
                          <form action={deleteEvent}>
                            <input type="hidden" name="id" value={event.id} />
                            <button
                              type="submit"
                              className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </form>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
