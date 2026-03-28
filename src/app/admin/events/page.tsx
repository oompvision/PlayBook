import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { resolveLocationId } from "@/lib/location";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  CalendarDays,
  Users,
  Copy,
  Pencil,
  Trash2,
  Eye,
  Send,
  XCircle,
  LayoutTemplate,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import { SavedToast } from "@/components/admin/saved-toast";

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

  // Fetch template colors
  const { data: allTemplates } = await supabase
    .from("event_templates")
    .select("id, config")
    .eq("org_id", org.id);
  const templateColorMap: Record<string, string> = {};
  for (const t of allTemplates || []) {
    templateColorMap[t.id] = (t.config as Record<string, unknown>)?.color as string || "#3B82F6";
  }

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
  const tz = org.timezone || "America/New_York";
  const now = new Date();

  const formatTimeOnly = (isoString: string) => {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(isoString));
  };

  const formatDateLabel = (isoString: string) => {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(isoString));
  };

  const getDateKey = (isoString: string) => {
    return new Date(isoString).toLocaleDateString("en-CA", { timeZone: tz });
  };

  const statusBadgeClass = (status: string, isPast: boolean) => {
    if (isPast && status !== "cancelled") {
      return "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";
    }
    switch (status) {
      case "published":
        return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
      case "draft":
        return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
      case "cancelled":
        return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
      default:
        return "bg-gray-100 text-gray-500";
    }
  };

  const getDisplayStatus = (status: string, isPast: boolean) => {
    if (isPast && status !== "cancelled") return "completed";
    return status;
  };

  // Group events by date
  type EventWithMeta = (typeof events extends (infer T)[] | null ? T : never) & { _isPast: boolean; _dateKey: string; _color: string };
  const upcomingGroups: Record<string, EventWithMeta[]> = {};
  const completedGroups: Record<string, EventWithMeta[]> = {};

  for (const event of events || []) {
    const isPast = new Date(event.end_time) < now;
    const dateKey = getDateKey(event.start_time);
    const color = event.template_id ? (templateColorMap[event.template_id] || "#3B82F6") : "#3B82F6";
    const eventWithMeta = { ...event, _isPast: isPast, _dateKey: dateKey, _color: color } as EventWithMeta;

    // Apply status filter
    const displayStatus = getDisplayStatus(event.status, isPast);
    if (statusFilter !== "all" && displayStatus !== statusFilter) continue;

    if (isPast) {
      if (!completedGroups[dateKey]) completedGroups[dateKey] = [];
      completedGroups[dateKey].push(eventWithMeta);
    } else {
      if (!upcomingGroups[dateKey]) upcomingGroups[dateKey] = [];
      upcomingGroups[dateKey].push(eventWithMeta);
    }
  }

  // Sort: upcoming = nearest first; completed = most recent first
  const upcomingDates = Object.keys(upcomingGroups).sort();
  const completedDates = Object.keys(completedGroups).sort().reverse();

  // Sort events within each date by start_time ascending
  for (const dateKey of [...upcomingDates, ...completedDates]) {
    const group = upcomingGroups[dateKey] || completedGroups[dateKey];
    group.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  const totalEvents = (events || []).filter((e) => {
    const isPast = new Date(e.end_time) < now;
    const displayStatus = getDisplayStatus(e.status, isPast);
    return statusFilter === "all" || displayStatus === statusFilter;
  }).length;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderEventCard(event: EventWithMeta, actions: any) {
    const registered = regCounts[event.id] || 0;
    const spotsLeft = event.capacity - registered;
    const bayNames = event.event_bays
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ?.map((eb: any) => eb.bays?.name ?? eb.bays?.[0]?.name)
      .filter(Boolean)
      .join(", ");
    const displayStatus = getDisplayStatus(event.status, event._isPast);

    return (
      <div key={event.id} className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: event._color }}
          />
          <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-gray-800 dark:text-white/90">
              {event.name}
            </p>
            <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(event.status, event._isPast)}`}>
              {displayStatus}
            </span>
            {event.members_only && (
              <span className="inline-flex shrink-0 items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                Members
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTimeOnly(event.start_time)} – {formatTimeOnly(event.end_time)}
            </span>
            {bayNames && <span>{bayNames}</span>}
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {registered}/{event.capacity}
              {spotsLeft === 0 && <span className="font-medium text-red-500">Full</span>}
            </span>
            <span className="font-medium">
              {event.price_cents === 0 ? "Free" : `$${(event.price_cents / 100).toFixed(2)}`}
            </span>
          </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
        </div>
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderEventActions(event: any) {
    return (
      <>
        <Link
          href={`/admin/events/${event.id}${locationId ? `?location=${locationId}` : ""}`}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
          title="View"
        >
          <Eye className="h-4 w-4" />
        </Link>
        {event.status === "draft" && (
          <form action={publishEvent}>
            <input type="hidden" name="id" value={event.id} />
            {locationId && <input type="hidden" name="location" value={locationId} />}
            <button type="submit" className="rounded-lg p-1.5 text-green-600 transition-colors hover:bg-green-50 dark:text-green-400" title="Publish">
              <Send className="h-4 w-4" />
            </button>
          </form>
        )}
        <Link
          href={`/admin/events/${event.id}/edit${locationId ? `?location=${locationId}` : ""}`}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
          title="Edit"
        >
          <Pencil className="h-4 w-4" />
        </Link>
        <form action={duplicateEvent}>
          <input type="hidden" name="id" value={event.id} />
          {locationId && <input type="hidden" name="location" value={locationId} />}
          <button type="submit" className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800" title="Duplicate">
            <Copy className="h-4 w-4" />
          </button>
        </form>
        {event.status === "published" && !event._isPast && (
          <form action={cancelEvent}>
            <input type="hidden" name="id" value={event.id} />
            {locationId && <input type="hidden" name="location" value={locationId} />}
            <button type="submit" className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30" title="Cancel">
              <XCircle className="h-4 w-4" />
            </button>
          </form>
        )}
        {event.status === "draft" && (
          <form action={deleteEvent}>
            <input type="hidden" name="id" value={event.id} />
            {locationId && <input type="hidden" name="location" value={locationId} />}
            <button type="submit" className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30" title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          </form>
        )}
      </>
    );
  }

  // Get ISO week number for week break detection
  function getWeekNumber(dateStr: string): number {
    const d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  function renderDateGroup(dateKey: string, groupEvents: EventWithMeta[], index: number, defaultOpen: boolean) {
    const dateLabel = formatDateLabel(groupEvents[0].start_time);
    const count = groupEvents.length;

    return (
      <details key={dateKey} open={defaultOpen || undefined} className="group">
        <summary className="flex cursor-pointer items-center gap-3 bg-gray-100 px-5 py-3 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700">
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-500 transition-transform group-open:rotate-90 dark:text-gray-400" />
          <span className="text-sm font-semibold text-gray-800 dark:text-white/90">
            {dateLabel}
          </span>
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-600 dark:text-gray-200">
            {count} event{count !== 1 ? "s" : ""}
          </span>
        </summary>
        <div className="divide-y divide-gray-50 dark:divide-white/[0.03]">
          {groupEvents.map((event) =>
            renderEventCard(event, renderEventActions(event))
          )}
        </div>
      </details>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Events
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Create and manage open-enrollment events — clinics, group sessions, and more.
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
            href={`/admin/events/calendar${locationId ? `?location=${locationId}` : ""}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <CalendarDays className="h-4 w-4" />
            Event Calendar
          </Link>
        </div>
      </div>

      {/* Alerts */}
      {params.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {params.error}
        </div>
      )}
      <SavedToast message="Event saved successfully." />

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

      {totalEvents === 0 ? (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="px-6 py-16 text-center">
            <CalendarDays className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
              No events found
            </p>
            <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
              {statusFilter !== "all" ? `No ${statusFilter} events.` : "Create your first event to start accepting registrations."}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Upcoming Events */}
          {upcomingDates.length > 0 && (
            <div>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <CalendarDays className="h-4 w-4" />
                Upcoming
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  {upcomingDates.reduce((sum, d) => sum + upcomingGroups[d].length, 0)}
                </span>
              </h2>
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
                {upcomingDates.map((dateKey, i) => {
                  const prevKey = i > 0 ? upcomingDates[i - 1] : null;
                  const showWeekBreak = prevKey && getWeekNumber(dateKey) !== getWeekNumber(prevKey);
                  return (
                    <div key={dateKey}>
                      {showWeekBreak && (
                        <div className="border-t-2 border-gray-300 dark:border-gray-600" />
                      )}
                      {renderDateGroup(dateKey, upcomingGroups[dateKey], i, i < 5)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Completed Events */}
          {completedDates.length > 0 && (
            <div>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <Clock className="h-4 w-4" />
                Completed
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                  {completedDates.reduce((sum, d) => sum + completedGroups[d].length, 0)}
                </span>
              </h2>
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
                {completedDates.map((dateKey, i) => {
                  const prevKey = i > 0 ? completedDates[i - 1] : null;
                  const showWeekBreak = prevKey && getWeekNumber(dateKey) !== getWeekNumber(prevKey);
                  return (
                    <div key={dateKey}>
                      {showWeekBreak && (
                        <div className="border-t-2 border-gray-300 dark:border-gray-600" />
                      )}
                      {renderDateGroup(dateKey, completedGroups[dateKey], i, i < 5)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
