import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getTodayInTimezone } from "@/lib/utils";
import { AvailabilityWidget } from "@/components/availability-widget";
import { OrgHeader } from "@/components/org-header";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default async function ModifyBookingPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;

  const supabase = await createClient();
  const auth = await getAuthUser();
  if (!auth) redirect(`/auth/login?redirect=/modify/${bookingId}`);

  // Fetch the booking first — derive org from its org_id so this works
  // without facility slug (preview links, direct URL access, etc.)
  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, org_id, customer_id, bay_id, date, start_time, end_time, total_price_cents, status, confirmation_code, notes, is_guest, guest_name"
    )
    .eq("id", bookingId)
    .single();

  if (!booking) redirect("/my-bookings");

  // Fetch the org from the booking's org_id
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, min_booking_lead_minutes, logo_url")
    .eq("id", booking.org_id)
    .single();

  if (!org) redirect("/my-bookings");

  // Validate: booking must be confirmed
  if (booking.status !== "confirmed") redirect("/my-bookings");

  // Auth check: customer must own it, OR user must be admin/super_admin
  const isOwner =
    !booking.is_guest && booking.customer_id === auth.profile.id;
  const isAdmin =
    auth.profile.role === "admin" || auth.profile.role === "super_admin";

  if (!isOwner && !isAdmin) redirect("/my-bookings");

  // Check min_booking_lead_minutes — can't modify if booking starts too soon
  const timezone = org.timezone ?? "America/New_York";
  const minLeadMinutes = isAdmin ? 0 : (org.min_booking_lead_minutes ?? 15);
  const bookingStart = new Date(booking.start_time).getTime();
  const cutoff = Date.now() + minLeadMinutes * 60_000;
  if (bookingStart <= cutoff && !isAdmin) {
    redirect("/my-bookings?error=" + encodeURIComponent("This booking can no longer be modified."));
  }

  // Fetch the booking's slot IDs
  const { data: bookingSlots } = await supabase
    .from("booking_slots")
    .select("bay_schedule_slot_id")
    .eq("booking_id", bookingId);

  const slotIds = bookingSlots?.map((s) => s.bay_schedule_slot_id) ?? [];

  // Fetch bays
  const { data: bays } = await supabase
    .from("bays")
    .select("id, name, resource_type")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");

  // Get bay name for original booking
  const bayName =
    bays?.find((b) => b.id === booking.bay_id)?.name ?? "Unknown";

  const todayStr = getTodayInTimezone(timezone);

  // Determine redirect base: admin goes to /admin/bookings, customer goes to /my-bookings
  const redirectBase = isAdmin && !isOwner ? "/admin/bookings" : "/my-bookings";
  const backHref = isAdmin && !isOwner ? "/admin/bookings" : "/my-bookings";

  return (
    <div className="min-h-screen p-8">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-6">
          <Link
            href={backHref}
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Bookings
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Modify Booking
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Modifying{" "}
                <span className="font-mono font-semibold">
                  {booking.confirmation_code}
                </span>{" "}
                &mdash; select new time slots below.
              </p>
            </div>
            <OrgHeader name={org.name} logoUrl={org.logo_url} />
          </div>
        </div>

        {/* Availability Widget in modify mode */}
        {bays && bays.length > 0 ? (
          <AvailabilityWidget
            orgId={org.id}
            orgName={org.name}
            timezone={timezone}
            bays={bays}
            todayStr={todayStr}
            minBookingLeadMinutes={minLeadMinutes}
            isAuthenticated={true}
            userEmail={auth.profile.email}
            userFullName={auth.profile.full_name}
            userProfileId={auth.profile.id}
            mode="modify"
            originalBooking={{
              id: booking.id,
              confirmationCode: booking.confirmation_code,
              bayId: booking.bay_id,
              bayName,
              date: booking.date,
              startTime: booking.start_time,
              endTime: booking.end_time,
              totalPriceCents: booking.total_price_cents,
              notes: booking.notes,
              isGuest: booking.is_guest,
              slotIds: slotIds,
            }}
            modifyRedirectBase={redirectBase}
          />
        ) : (
          <div className="rounded-xl border bg-card p-12 text-center">
            <p className="text-muted-foreground">
              No facilities are currently available.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
