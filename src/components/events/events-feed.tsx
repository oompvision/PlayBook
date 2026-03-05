import { createClient } from "@/lib/supabase/server";
import { EventCard } from "./event-card";

type EventsFeedProps = {
  orgId: string;
  timezone: string;
  isAuthenticated: boolean;
  isMember: boolean;
  userId?: string;
};

export async function EventsFeed({
  orgId,
  timezone,
  isAuthenticated,
  isMember,
  userId,
}: EventsFeedProps) {
  const supabase = await createClient();

  const { data: events } = await supabase
    .from("events")
    .select(`
      id,
      name,
      description,
      start_time,
      end_time,
      capacity,
      price_cents,
      members_only,
      member_enrollment_days_before,
      guest_enrollment_days_before,
      status,
      event_bays (
        bay_id,
        bays:bay_id (name)
      )
    `)
    .eq("org_id", orgId)
    .eq("status", "published")
    .gte("end_time", new Date().toISOString())
    .order("start_time", { ascending: true });

  if (!events || events.length === 0) return null;

  // Get registration counts for all events
  const eventIds = events.map((e) => e.id);
  const { data: regCounts } = await supabase
    .from("event_registrations")
    .select("event_id, status")
    .in("event_id", eventIds)
    .in("status", ["confirmed", "pending_payment"]);

  const countMap: Record<string, number> = {};
  for (const r of regCounts ?? []) {
    countMap[r.event_id] = (countMap[r.event_id] || 0) + 1;
  }

  // Get user's existing registrations
  let userRegs: Record<string, string> = {};
  if (userId) {
    const { data: myRegs } = await supabase
      .from("event_registrations")
      .select("event_id, status")
      .eq("user_id", userId)
      .in("event_id", eventIds)
      .in("status", ["confirmed", "waitlisted", "pending_payment"]);

    for (const r of myRegs ?? []) {
      userRegs[r.event_id] = r.status;
    }
  }

  // Filter: hide members-only events from non-members
  const visibleEvents = events.filter((e) => {
    if (e.members_only && !isMember) return false;
    return true;
  });

  if (visibleEvents.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
        Upcoming Events
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleEvents.map((event) => {
          const registered = countMap[event.id] || 0;
          const bayNames = event.event_bays
            ?.map((eb: { bays: { name: string } | null }) => eb.bays?.name)
            .filter(Boolean)
            .join(", ");
          const userStatus = userRegs[event.id] || null;

          return (
            <EventCard
              key={event.id}
              event={{
                id: event.id,
                name: event.name,
                description: event.description,
                startTime: event.start_time,
                endTime: event.end_time,
                capacity: event.capacity,
                registeredCount: registered,
                priceCents: event.price_cents,
                membersOnly: event.members_only,
                memberEnrollmentDaysBefore: event.member_enrollment_days_before,
                guestEnrollmentDaysBefore: event.guest_enrollment_days_before,
                bayNames: bayNames || "",
              }}
              timezone={timezone}
              isAuthenticated={isAuthenticated}
              isMember={isMember}
              userRegistrationStatus={userStatus}
            />
          );
        })}
      </div>
    </div>
  );
}
