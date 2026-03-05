import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { resolveLocationId } from "@/lib/location";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { EventForm } from "@/components/admin/event-form";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, membership_tiers_enabled")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function EditEventPage({
  params: paramsPromise,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ location?: string; error?: string }>;
}) {
  const { id } = await paramsPromise;
  const search = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const locationId = await resolveLocationId(org.id, search.location);

  // Fetch event with bay assignments
  const { data: event } = await supabase
    .from("events")
    .select("*, event_bays(bay_id)")
    .eq("id", id)
    .eq("org_id", org.id)
    .single();

  if (!event) redirect("/admin/events");

  // Fetch active bays for this org/location
  const baysQuery = supabase
    .from("bays")
    .select("id, name, resource_type, is_active")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("sort_order")
    .order("name");
  if (locationId) baysQuery.eq("location_id", locationId);
  const { data: bays } = await baysQuery;

  async function updateEvent(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;

    const supabase = await createClient();
    const eventId = formData.get("id") as string;
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";

    // Parse form data
    const name = formData.get("name") as string;
    const description = (formData.get("description") as string) || null;
    const date = formData.get("date") as string;
    const startTime = formData.get("start_time") as string;
    const endTime = formData.get("end_time") as string;
    const capacity = parseInt(formData.get("capacity") as string, 10);
    const price = parseFloat(formData.get("price") as string) || 0;
    const membersOnly = formData.get("members_only") === "true";
    const memberEnrollmentDays = formData.get("member_enrollment_days_before")
      ? parseInt(formData.get("member_enrollment_days_before") as string, 10)
      : null;
    const guestEnrollmentDays = parseInt(
      formData.get("guest_enrollment_days_before") as string,
      10
    ) || 7;
    const waitlistHours = parseInt(
      formData.get("waitlist_promotion_hours") as string,
      10
    ) || 24;
    const bayIds: string[] = JSON.parse(
      (formData.get("bay_ids") as string) || "[]"
    );

    // Build timestamptz from date + time
    const startTimestamp = `${date}T${startTime}:00`;
    const endTimestamp = `${date}T${endTime}:00`;

    const { error } = await supabase
      .from("events")
      .update({
        name,
        description,
        start_time: startTimestamp,
        end_time: endTimestamp,
        capacity,
        price_cents: Math.round(price * 100),
        members_only: membersOnly,
        member_enrollment_days_before: memberEnrollmentDays,
        guest_enrollment_days_before: guestEnrollmentDays,
        waitlist_promotion_hours: waitlistHours,
      })
      .eq("id", eventId)
      .eq("org_id", org.id);

    if (error) {
      redirect(
        `/admin/events/${eventId}/edit?error=${encodeURIComponent(error.message)}${locParam ? `&${locParam.slice(1)}` : ""}`
      );
    }

    // Sync bay assignments: delete old, insert new
    await supabase.from("event_bays").delete().eq("event_id", eventId);

    if (bayIds.length > 0) {
      const { error: bayError } = await supabase.from("event_bays").insert(
        bayIds.map((bayId) => ({
          event_id: eventId,
          bay_id: bayId,
        }))
      );
      if (bayError) {
        redirect(
          `/admin/events/${eventId}/edit?error=${encodeURIComponent(bayError.message)}${locParam ? `&${locParam.slice(1)}` : ""}`
        );
      }
    }

    revalidatePath("/admin/events");
    redirect(`/admin/events?saved=true${locParam}`);
  }

  async function publishEvent() {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();
    const loc = locationId ? `&location=${locationId}` : "";

    const { error } = await supabase.rpc("publish_event", {
      p_event_id: id,
      p_cancel_conflicting_bookings: false,
    });

    if (error) {
      redirect(
        `/admin/events/${id}/edit?error=${encodeURIComponent(error.message)}${loc ? `&${loc.slice(1)}` : ""}`
      );
    }

    revalidatePath("/admin/events");
    redirect(`/admin/events?saved=true${loc}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            Edit Event
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Update event details. Changes to published events will notify registered users.
          </p>
        </div>
        {event.status === "draft" && (
          <form action={publishEvent}>
            <button
              type="submit"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-green-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-green-700"
            >
              Publish Event
            </button>
          </form>
        )}
      </div>

      {search.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {search.error}
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-white/[0.05] dark:bg-white/[0.03]">
        <EventForm
          bays={bays ?? []}
          timezone={org.timezone || "America/New_York"}
          event={event}
          action={updateEvent}
          locationId={locationId}
          submitLabel="Save Changes"
          membershipEnabled={org.membership_tiers_enabled}
          showRecurring={event.status === "draft"}
          showSaveTemplate={event.status === "draft"}
        />
      </div>
    </div>
  );
}
