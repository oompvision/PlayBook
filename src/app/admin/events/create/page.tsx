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

export default async function CreateEventPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; template?: string }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const locationId = await resolveLocationId(org.id, params.location);

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

  // Fetch template for pre-fill if ?template=ID is provided
  let templateEvent: {
    name: string;
    description: string | null;
    start_time: string;
    end_time: string;
    capacity: number;
    price_cents: number;
    members_only: boolean;
    member_enrollment_days_before: number | null;
    guest_enrollment_days_before: number;
    waitlist_promotion_hours: number;
    status: string;
  } | undefined;

  if (params.template) {
    const { data: tpl } = await supabase
      .from("event_templates")
      .select("name, config")
      .eq("id", params.template)
      .eq("org_id", org.id)
      .single();

    if (tpl?.config) {
      const c = tpl.config as Record<string, unknown>;
      templateEvent = {
        name: "",
        description: (c.description as string) || null,
        start_time: "",
        end_time: "",
        capacity: (c.capacity as number) || 12,
        price_cents: (c.price_cents as number) || 0,
        members_only: (c.members_only as boolean) || false,
        member_enrollment_days_before: (c.member_enrollment_days_before as number) ?? null,
        guest_enrollment_days_before: (c.guest_enrollment_days_before as number) ?? 7,
        waitlist_promotion_hours: (c.waitlist_promotion_hours as number) ?? 24,
        status: "draft",
      };
    }
  }

  async function createEvent(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;

    const supabase = await createClient();
    const loc = formData.get("location") as string | null;
    const locParam = loc ? `&location=${loc}` : "";
    const tz = (formData.get("timezone") as string) || org.timezone || "America/New_York";

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/auth/login");

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

    // Build timestamptz from date + time + timezone
    const startTimestamp = `${date}T${startTime}:00`;
    const endTimestamp = `${date}T${endTime}:00`;

    // Resolve location for insert
    const locationId = loc
      ? (await import("@/lib/location")).resolveLocationId(org.id, loc).then((id) => id)
      : null;
    const resolvedLocationId = loc ? await locationId : null;

    const { data: newEvent, error } = await supabase
      .from("events")
      .insert({
        org_id: org.id,
        location_id: resolvedLocationId,
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
        status: "draft",
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !newEvent) {
      redirect(
        `/admin/events/create?error=${encodeURIComponent(error?.message || "Failed to create event")}${locParam ? `&${locParam.slice(1)}` : ""}`
      );
    }

    // Insert bay assignments
    if (bayIds.length > 0) {
      const { error: bayError } = await supabase.from("event_bays").insert(
        bayIds.map((bayId) => ({
          event_id: newEvent.id,
          bay_id: bayId,
        }))
      );
      if (bayError) {
        // Clean up the event if bay assignment fails
        await supabase.from("events").delete().eq("id", newEvent.id);
        redirect(
          `/admin/events/create?error=${encodeURIComponent(bayError.message)}${locParam ? `&${locParam.slice(1)}` : ""}`
        );
      }
    }

    // Handle recurring event creation
    const recurringEnabled = formData.get("recurring_enabled") === "true";
    if (recurringEnabled) {
      const recurringDay = parseInt(formData.get("recurring_day") as string, 10);
      const recurringEndType = formData.get("recurring_end_type") as string;

      if (!isNaN(recurringDay)) {
        const rpcParams: Record<string, unknown> = {
          p_event_id: newEvent.id,
          p_day_of_week: recurringDay,
        };

        if (recurringEndType === "date") {
          const endDate = formData.get("recurring_end_date") as string;
          if (endDate) rpcParams.p_end_date = endDate;
        } else {
          const occurrences = parseInt(formData.get("recurring_occurrences") as string, 10);
          if (!isNaN(occurrences) && occurrences > 0) rpcParams.p_occurrences = occurrences;
        }

        await supabase.rpc("create_recurring_event_instances", rpcParams);
      }
    }

    // Handle save as template
    const saveAsTemplate = formData.get("save_as_template") === "true";
    if (saveAsTemplate) {
      const templateName = (formData.get("template_name") as string) || name;
      await supabase.from("event_templates").insert({
        org_id: org.id,
        name: templateName,
        config: {
          capacity,
          price_cents: Math.round(price * 100),
          members_only: membersOnly,
          member_enrollment_days_before: memberEnrollmentDays,
          guest_enrollment_days_before: guestEnrollmentDays,
          waitlist_promotion_hours: waitlistHours,
          description,
        },
      });
    }

    revalidatePath("/admin/events");
    redirect(`/admin/events?saved=true${locParam}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Create Event
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Set up a new open-enrollment event for your facility.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-white/[0.05] dark:bg-white/[0.03]">
        <EventForm
          bays={bays ?? []}
          timezone={org.timezone || "America/New_York"}
          action={createEvent}
          locationId={locationId}
          submitLabel="Create Event"
          membershipEnabled={org.membership_tiers_enabled}
          event={templateEvent}
          showRecurring
          showSaveTemplate
        />
      </div>
    </div>
  );
}
