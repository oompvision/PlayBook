import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getTodayInTimezone } from "@/lib/utils";
import { AvailabilityWidget } from "@/components/availability-widget";
import { ArrowLeft } from "lucide-react";

export default async function GuestBookingPage() {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, min_booking_lead_minutes")
    .eq("slug", slug)
    .single();

  if (!org) redirect("/");
  await requireAdmin(org.id);

  const { data: bays } = await supabase
    .from("bays")
    .select("id, name, resource_type")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");

  const timezone = org.timezone ?? "America/New_York";
  const todayStr = getTodayInTimezone(timezone);

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6">
        <a
          href="/admin/bookings"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Bookings
        </a>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Add Guest Booking
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Select time slots and enter guest details to create a booking.
        </p>
      </div>

      {/* Availability Widget in admin-guest mode */}
      {bays && bays.length > 0 ? (
        <AvailabilityWidget
          orgId={org.id}
          orgName={org.name}
          timezone={timezone}
          bays={bays}
          todayStr={todayStr}
          minBookingLeadMinutes={0}
          isAuthenticated={true}
          mode="admin-guest"
        />
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white px-5 py-16 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
          No facilities are currently available. Add bays and publish schedules first.
        </div>
      )}
    </div>
  );
}
