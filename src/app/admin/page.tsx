import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { getTodayInTimezone } from "@/lib/utils";
import { getOrgLocations } from "@/lib/location";
import { DailyDashboard } from "@/components/admin/daily-dashboard";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, events_enabled")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const today = getTodayInTimezone(org.timezone);
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today;

  // Get all locations (even for single-location orgs, there's always a default)
  const locations = await getOrgLocations(org.id);

  // Fetch all active bays grouped by location
  const { data: allBays } = await supabase
    .from("bays")
    .select("id, name, location_id, sort_order")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  // Fetch all bookings for this date (both confirmed and cancelled)
  const { data: allBookings } = await supabase
    .from("bookings")
    .select("id, bay_id, status, start_time, end_time, total_price_cents")
    .eq("org_id", org.id)
    .eq("date", date);

  // Fetch events for this date (events whose start_time falls on this date)
  // We compare the date portion in the org's timezone
  const dayStart = `${date}T00:00:00`;
  const dayEnd = `${date}T23:59:59`;

  // Get events that overlap with this date
  const { data: allEvents } = await supabase
    .from("events")
    .select("id, name, capacity, start_time, end_time, status")
    .eq("org_id", org.id)
    .in("status", ["published", "completed"])
    .lte("start_time", dayEnd)
    .gte("end_time", dayStart);

  // Get event_bays for those events
  let eventBayMap: Record<string, { eventId: string; name: string; capacity: number }[]> = {};
  let eventRegistrationCounts: Record<string, number> = {};

  if (allEvents && allEvents.length > 0) {
    const eventIds = allEvents.map((e) => e.id);

    const { data: eventBays } = await supabase
      .from("event_bays")
      .select("event_id, bay_id")
      .in("event_id", eventIds);

    if (eventBays) {
      for (const eb of eventBays) {
        if (!eventBayMap[eb.bay_id]) eventBayMap[eb.bay_id] = [];
        const event = allEvents.find((e) => e.id === eb.event_id);
        if (event) {
          eventBayMap[eb.bay_id].push({
            eventId: event.id,
            name: event.name,
            capacity: event.capacity,
          });
        }
      }
    }

    // Count registrations per event
    const { data: regCounts } = await supabase
      .from("event_registrations")
      .select("event_id")
      .in("event_id", eventIds)
      .in("status", ["confirmed", "pending_payment"]);

    if (regCounts) {
      for (const r of regCounts) {
        eventRegistrationCounts[r.event_id] = (eventRegistrationCounts[r.event_id] || 0) + 1;
      }
    }
  }

  // Current time for determining booking status
  const now = new Date();

  // Build location data
  const locationData = locations.map((loc) => {
    const locationBays = (allBays || []).filter((b) => b.location_id === loc.id);

    const bays = locationBays.map((bay) => {
      const bayBookings = (allBookings || []).filter((b) => b.bay_id === bay.id);

      let upcoming = 0;
      let active = 0;
      let completed = 0;
      let cancelled = 0;
      let revenueCents = 0;

      for (const booking of bayBookings) {
        if (booking.status === "cancelled") {
          cancelled++;
          continue;
        }

        // Confirmed booking — classify by time
        const start = new Date(booking.start_time);
        const end = new Date(booking.end_time);

        if (now >= start && now < end) {
          active++;
        } else if (now >= end) {
          completed++;
        } else {
          upcoming++;
        }

        revenueCents += booking.total_price_cents;
      }

      // Events for this bay
      const bayEvents = (eventBayMap[bay.id] || []).map((ev) => ({
        name: ev.name,
        registered: eventRegistrationCounts[ev.eventId] || 0,
        capacity: ev.capacity,
      }));

      return {
        bayId: bay.id,
        bayName: bay.name,
        upcoming,
        active,
        completed,
        cancelled,
        revenueCents,
        events: bayEvents,
      };
    });

    return {
      locationId: loc.id,
      locationName: loc.name,
      locationAddress: loc.address || null,
      bays,
    };
  });

  return (
    <DailyDashboard
      date={date}
      today={today}
      timezone={org.timezone}
      locations={locationData}
      renderedAt={now.toISOString()}
    />
  );
}
