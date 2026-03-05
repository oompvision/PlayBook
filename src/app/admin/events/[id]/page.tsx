import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { resolveLocationId } from "@/lib/location";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Pencil,
  Send,
  XCircle,
  Users,
  CalendarDays,
  Clock,
  DollarSign,
  Building2,
  UserMinus,
  Download,
  CheckCircle2,
} from "lucide-react";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, scheduling_type")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function EventDetailPage({
  params: paramsPromise,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ location?: string; error?: string; saved?: string }>;
}) {
  const { id } = await paramsPromise;
  const search = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const locationId = await resolveLocationId(org.id, search.location);
  const locParam = locationId ? `?location=${locationId}` : "";

  // Fetch event with bay assignments
  const { data: event } = await supabase
    .from("events")
    .select(`
      *,
      event_bays (
        bay_id,
        bays:bay_id (name)
      )
    `)
    .eq("id", id)
    .eq("org_id", org.id)
    .single();

  if (!event) redirect("/admin/events");

  // Fetch registrations with user profiles
  type RegRow = {
    id: string;
    user_id: string;
    status: string;
    waitlist_position: number | null;
    payment_status: string | null;
    registered_at: string;
    cancelled_at: string | null;
    promoted_at: string | null;
    profiles: { full_name: string | null; email: string } | null;
  };

  const { data: rawRegistrations } = await supabase
    .from("event_registrations")
    .select(`
      id,
      user_id,
      status,
      waitlist_position,
      payment_status,
      registered_at,
      cancelled_at,
      promoted_at,
      profiles:user_id (full_name, email)
    `)
    .eq("event_id", id)
    .order("registered_at", { ascending: true });

  const registrations = (rawRegistrations ?? []) as unknown as RegRow[];

  // Check for conflicts before publishing
  let conflicts: { affected_slots: number; affected_bookings: number } | null = null;
  if (event.status === "draft") {
    const { data } = await supabase.rpc("check_event_conflicts", {
      p_event_id: id,
    });
    if (data) conflicts = data;
  }

  async function publishEvent(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const eventId = formData.get("id") as string;
    const cancelConflicts = formData.get("cancel_conflicts") === "true";
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";

    const { error } = await supabase.rpc("publish_event", {
      p_event_id: eventId,
      p_cancel_conflicting_bookings: cancelConflicts,
    });

    if (error) {
      redirect(
        `/admin/events/${eventId}?error=${encodeURIComponent(error.message)}${locParam}`
      );
    }

    revalidatePath(`/admin/events/${eventId}`);
    redirect(`/admin/events/${eventId}?saved=true${locParam ? `&${locParam.slice(1)}` : ""}`);
  }

  async function cancelEvent(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const eventId = formData.get("id") as string;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";

    const { error } = await supabase.rpc("cancel_event", {
      p_event_id: eventId,
    });

    if (error) {
      redirect(
        `/admin/events/${eventId}?error=${encodeURIComponent(error.message)}${locParam}`
      );
    }

    revalidatePath(`/admin/events/${eventId}`);
    redirect(`/admin/events/${eventId}?saved=true${locParam ? `&${locParam.slice(1)}` : ""}`);
  }

  async function removeAttendee(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const regId = formData.get("registration_id") as string;
    const eventId = formData.get("event_id") as string;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";

    const { error } = await supabase.rpc("cancel_event_registration", {
      p_registration_id: regId,
    });

    if (error) {
      redirect(
        `/admin/events/${eventId}?error=${encodeURIComponent(error.message)}${locParam}`
      );
    }

    revalidatePath(`/admin/events/${eventId}`);
    redirect(`/admin/events/${eventId}?saved=true${locParam ? `&${locParam.slice(1)}` : ""}`);
  }

  const formatDateTime = (isoString: string) => {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: org.timezone || "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(isoString));
  };

  const formatTime = (isoString: string) => {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: org.timezone || "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(isoString));
  };

  const bayNames = event.event_bays
    ?.map((eb: { bays: { name: string }[] | null }) => eb.bays?.[0]?.name)
    .filter(Boolean)
    .join(", ");

  const activeRegs = registrations.filter((r) => r.status !== "cancelled");
  const confirmedCount = activeRegs.filter(
    (r) => r.status === "confirmed" || r.status === "pending_payment"
  ).length;
  const waitlistedCount = activeRegs.filter((r) => r.status === "waitlisted").length;

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

  const regStatusBadge = (status: string) => {
    switch (status) {
      case "confirmed":
        return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
      case "waitlisted":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
      case "pending_payment":
        return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
      case "cancelled":
        return "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";
      default:
        return "bg-gray-100 text-gray-500";
    }
  };

  // Build CSV data for export
  const csvRows = [
    ["Name", "Email", "Status", "Payment", "Registered At"].join(","),
    ...(activeRegs.map((r) => {
      const profile = r.profiles;
      return [
        `"${profile?.full_name || "N/A"}"`,
        `"${profile?.email || "N/A"}"`,
        r.status,
        r.payment_status || "n/a",
        new Date(r.registered_at).toISOString(),
      ].join(",");
    })),
  ].join("\n");
  const csvDataUri = `data:text/csv;charset=utf-8,${encodeURIComponent(csvRows)}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/admin/events${locParam}`}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
                {event.name}
              </h1>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(event.status)}`}
              >
                {event.status}
              </span>
              {event.members_only && (
                <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                  Members Only
                </span>
              )}
            </div>
            {event.description && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {event.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {event.status === "draft" && (
            <form action={publishEvent}>
              <input type="hidden" name="id" value={event.id} />
              {locationId && <input type="hidden" name="location" value={locationId} />}
              {conflicts && conflicts.affected_bookings > 0 && (
                <input type="hidden" name="cancel_conflicts" value="true" />
              )}
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-green-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-green-700"
              >
                <Send className="h-4 w-4" />
                Publish
              </button>
            </form>
          )}
          <Link
            href={`/admin/events/${event.id}/edit${locParam}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
          {event.status === "published" && (
            <form action={cancelEvent}>
              <input type="hidden" name="id" value={event.id} />
              {locationId && <input type="hidden" name="location" value={locationId} />}
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 text-sm font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 dark:border-red-700 dark:bg-transparent dark:text-red-400"
              >
                <XCircle className="h-4 w-4" />
                Cancel Event
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Alerts */}
      {search.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {search.error}
        </div>
      )}
      {search.saved && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Changes saved.
        </div>
      )}

      {/* Conflict Warning */}
      {conflicts && (conflicts.affected_slots > 0 || conflicts.affected_bookings > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Publishing will affect existing availability:
          </p>
          <ul className="mt-1 list-inside list-disc text-sm text-amber-700 dark:text-amber-300">
            {conflicts.affected_slots > 0 && (
              <li>{conflicts.affected_slots} available slot(s) will be blocked</li>
            )}
            {conflicts.affected_bookings > 0 && (
              <li>
                {conflicts.affected_bookings} confirmed booking(s) will be cancelled
                (users will be notified)
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Event Info Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <CalendarDays className="h-4 w-4" />
            <span className="text-xs font-medium">Date &amp; Time</span>
          </div>
          <p className="mt-2 text-sm font-medium text-gray-800 dark:text-white/90">
            {formatDateTime(event.start_time)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            to {formatTime(event.end_time)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <Users className="h-4 w-4" />
            <span className="text-xs font-medium">Capacity</span>
          </div>
          <p className="mt-2 text-sm font-medium text-gray-800 dark:text-white/90">
            {confirmedCount} / {event.capacity} registered
          </p>
          {waitlistedCount > 0 && (
            <p className="text-xs text-blue-600 dark:text-blue-400">
              {waitlistedCount} on waitlist
            </p>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <DollarSign className="h-4 w-4" />
            <span className="text-xs font-medium">Price</span>
          </div>
          <p className="mt-2 text-sm font-medium text-gray-800 dark:text-white/90">
            {event.price_cents === 0
              ? "Free"
              : `$${(event.price_cents / 100).toFixed(2)}`}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <Building2 className="h-4 w-4" />
            <span className="text-xs font-medium">Facilities</span>
          </div>
          <p className="mt-2 text-sm font-medium text-gray-800 dark:text-white/90">
            {bayNames || "None assigned"}
          </p>
        </div>
      </div>

      {/* Attendee List */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-white/90">
              Attendees
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {activeRegs.length} registration{activeRegs.length !== 1 ? "s" : ""}
            </p>
          </div>
          {activeRegs.length > 0 && (
            <a
              href={csvDataUri}
              download={`${event.name.replace(/\s+/g, "_")}_attendees.csv`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-400"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </a>
          )}
        </div>

        {activeRegs.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Users className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              No registrations yet
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-white/[0.05]">
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    Payment
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    Registered
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {activeRegs.map((reg) => {
                  const profile = reg.profiles;

                  return (
                    <tr
                      key={reg.id}
                      className="transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]"
                    >
                      <td className="px-6 py-3">
                        <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                          {profile?.full_name || "N/A"}
                        </p>
                      </td>
                      <td className="px-6 py-3">
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {profile?.email || "N/A"}
                        </p>
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${regStatusBadge(reg.status)}`}
                        >
                          {reg.status === "pending_payment"
                            ? "Pending Payment"
                            : reg.status}
                          {reg.waitlist_position && ` #${reg.waitlist_position}`}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-xs text-gray-500 capitalize">
                          {reg.payment_status || "—"}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-xs text-gray-500">
                          {new Intl.DateTimeFormat("en-US", {
                            timeZone: org.timezone || "America/New_York",
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(reg.registered_at))}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right">
                        {reg.status !== "cancelled" && (
                          <form action={removeAttendee}>
                            <input
                              type="hidden"
                              name="registration_id"
                              value={reg.id}
                            />
                            <input
                              type="hidden"
                              name="event_id"
                              value={event.id}
                            />
                            {locationId && (
                              <input
                                type="hidden"
                                name="location"
                                value={locationId}
                              />
                            )}
                            <button
                              type="submit"
                              className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
                              title="Remove attendee"
                            >
                              <UserMinus className="h-4 w-4" />
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
