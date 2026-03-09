import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getTodayInTimezone, formatTimeInZone } from "@/lib/utils";
import { AvailabilityWidget } from "@/components/availability-widget";
import { DynamicAvailabilityWidget } from "@/components/dynamic-availability-widget";
import { OrgHeader } from "@/components/org-header";
import { ArrowLeft, ArrowRight } from "lucide-react";
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
      "id, org_id, customer_id, bay_id, date, start_time, end_time, total_price_cents, discount_cents, status, confirmation_code, notes, is_guest, guest_name, modified_from, location_id"
    )
    .eq("id", bookingId)
    .single();

  if (!booking) redirect("/my-bookings");

  // Fetch the org from the booking's org_id (include scheduling_type)
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, min_booking_lead_minutes, logo_url, scheduling_type, bookable_window_days, locations_enabled, membership_tiers_enabled, guest_booking_window_days, member_booking_window_days")
    .eq("id", booking.org_id)
    .single();

  if (!org) redirect("/my-bookings");

  const isDynamic = (org.scheduling_type ?? "slot_based") === "dynamic";

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

  // Check cancellation window — customers can't modify inside the no-refund window
  if (!isAdmin) {
    const serviceClient = createServiceClient();
    const { data: windowSettings } = await serviceClient
      .from("org_payment_settings")
      .select("cancellation_window_hours, payment_mode, stripe_onboarding_complete")
      .eq("org_id", org.id)
      .single();

    if (
      windowSettings &&
      windowSettings.payment_mode !== "none" &&
      windowSettings.stripe_onboarding_complete
    ) {
      const windowHours = windowSettings.cancellation_window_hours ?? 24;
      const windowCutoff = bookingStart - windowHours * 60 * 60 * 1000;
      if (Date.now() >= windowCutoff) {
        redirect(
          "/my-bookings?error=" +
            encodeURIComponent(
              `This booking is within the ${windowHours}-hour cancellation window and can no longer be modified.`
            )
        );
      }
    }
  }

  // Fetch the booking's slot IDs (for slot-based)
  const { data: bookingSlots } = await supabase
    .from("booking_slots")
    .select("bay_schedule_slot_id")
    .eq("booking_id", bookingId);

  const slotIds = bookingSlots?.map((s) => s.bay_schedule_slot_id) ?? [];

  // Fetch bays — scoped to the booking's location when locations are enabled
  let baysQuery = supabase
    .from("bays")
    .select("id, name, resource_type")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");

  if (org.locations_enabled && booking.location_id) {
    baysQuery = baysQuery.eq("location_id", booking.location_id);
  }

  const { data: bays } = await baysQuery;

  // Get bay name for original booking
  const bayName =
    bays?.find((b) => b.id === booking.bay_id)?.name ?? "Unknown";

  // Resolve modified_from info (if this booking was already previously modified)
  let modifiedFromInfo: { startTime: string; endTime: string; date: string; bayName: string } | null = null;
  if (booking.modified_from) {
    const { data: origBooking } = await supabase
      .from("bookings")
      .select("start_time, end_time, date, bay_id")
      .eq("id", booking.modified_from)
      .single();
    if (origBooking) {
      const origBayName = bays?.find((b) => b.id === origBooking.bay_id)?.name ?? "Facility";
      modifiedFromInfo = {
        startTime: origBooking.start_time,
        endTime: origBooking.end_time,
        date: origBooking.date,
        bayName: origBayName,
      };
    }
  }

  // Fetch payment mode + old booking's card info (uses service client to bypass RLS for customers)
  let paymentMode = "none";
  let oldPaymentCardBrand: string | null = null;
  let oldPaymentCardLast4: string | null = null;
  {
    const serviceClient = createServiceClient();
    const { data: paymentSettings } = await serviceClient
      .from("org_payment_settings")
      .select("payment_mode, stripe_onboarding_complete, stripe_account_id")
      .eq("org_id", org.id)
      .single();

    if (
      paymentSettings?.payment_mode &&
      paymentSettings.payment_mode !== "none" &&
      paymentSettings.stripe_onboarding_complete
    ) {
      paymentMode = paymentSettings.payment_mode;

      // Fetch the old booking's payment record to get card details
      const { data: oldPayment } = await serviceClient
        .from("booking_payments")
        .select("stripe_payment_method_id")
        .eq("booking_id", bookingId)
        .eq("org_id", org.id)
        .single();

      if (oldPayment?.stripe_payment_method_id && paymentSettings.stripe_account_id) {
        try {
          const { stripe } = await import("@/lib/stripe");
          const pm = await stripe.paymentMethods.retrieve(
            oldPayment.stripe_payment_method_id,
            { stripeAccount: paymentSettings.stripe_account_id }
          );
          oldPaymentCardBrand = pm.card?.brand || null;
          oldPaymentCardLast4 = pm.card?.last4 || null;
        } catch {
          // Non-critical — payment summary will show without card details
        }
      }
    }
  }

  const todayStr = getTodayInTimezone(timezone);

  // Determine redirect base: admin always goes to /admin/bookings, customer goes to /my-bookings
  const redirectBase = isAdmin ? "/admin/bookings" : "/my-bookings";
  const backHref = isAdmin ? "/admin/bookings" : "/my-bookings";

  // For dynamic orgs: fetch facility groups, standalone bays, durations
  let facilityGroups: Array<{
    id: string;
    name: string;
    description: string | null;
    bays: Array<{ id: string; name: string; resource_type: string | null }>;
  }> = [];
  let standaloneBays: Array<{ id: string; name: string; resource_type: string | null }> = [];
  let defaultDurations: number[] = [60];
  let bookableWindowDays = org.bookable_window_days ?? 30;

  if (isDynamic && bays && bays.length > 0) {
    let groupsQuery = supabase
      .from("facility_groups")
      .select("id, name, description")
      .eq("org_id", org.id);
    let rulesQuery = supabase
      .from("dynamic_schedule_rules")
      .select("available_durations")
      .eq("org_id", org.id)
      .limit(1);

    if (org.locations_enabled && booking.location_id) {
      groupsQuery = groupsQuery.eq("location_id", booking.location_id);
      rulesQuery = rulesQuery.eq("location_id", booking.location_id);
    }

    const [groupsResult, rulesResult] = await Promise.all([
      groupsQuery,
      rulesQuery,
    ]);

    const groups = groupsResult.data || [];

    // Build bay→group map
    if (groups.length > 0) {
      const { data: members } = await supabase
        .from("facility_group_members")
        .select("bay_id, group_id")
        .in("group_id", groups.map((g) => g.id));

      const bayGroupMap = new Map<string, string>();
      for (const m of (members || [])) {
        bayGroupMap.set(m.bay_id, m.group_id);
      }

      facilityGroups = groups.map((g) => ({
        ...g,
        bays: bays.filter((b) => bayGroupMap.has(b.id) && bayGroupMap.get(b.id) === g.id),
      })).filter((g) => g.bays.length > 0);

      standaloneBays = bays.filter((b) => !bayGroupMap.has(b.id));
    } else {
      standaloneBays = bays;
    }

    if (rulesResult.data?.[0]?.available_durations) {
      defaultDurations = rulesResult.data[0].available_durations;
    }

    // Get membership-aware bookable window
    const { data: windowData } = await supabase.rpc("get_effective_bookable_window", {
      p_org_id: org.id,
      p_user_id: auth.user.id,
    });
    if (typeof windowData === "number") {
      bookableWindowDays = windowData;
    }
  }

  // Calculate original booking duration for dynamic modify pre-fill
  const originalDurationMinutes = Math.round(
    (new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime()) / 60_000
  );

  // Original booking total paid (subtract discount)
  const originalPaidCents = booking.total_price_cents - (booking.discount_cents || 0);

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
                <span className="font-semibold">
                  {formatTimeInZone(booking.start_time, timezone)} &ndash;{" "}
                  {formatTimeInZone(booking.end_time, timezone)},{" "}
                  {new Date(booking.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })},{" "}
                  {bayName}
                </span>{" "}
                &mdash; select new time {isDynamic ? "slot" : "slots"} below.
              </p>
            </div>
            <OrgHeader name={org.name} logoUrl={org.logo_url} />
          </div>
          {modifiedFromInfo && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
              <ArrowRight className="h-3 w-3 shrink-0" />
              <span>
                Previously modified from{" "}
                <span className="font-semibold">
                  {formatTimeInZone(modifiedFromInfo.startTime, timezone)} &ndash;{" "}
                  {formatTimeInZone(modifiedFromInfo.endTime, timezone)},{" "}
                  {new Date(modifiedFromInfo.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })},{" "}
                  {modifiedFromInfo.bayName}
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Availability Widget in modify mode */}
        {bays && bays.length > 0 ? (
          isDynamic ? (
            <DynamicAvailabilityWidget
              orgId={org.id}
              orgName={org.name}
              timezone={timezone}
              bays={bays}
              facilityGroups={facilityGroups}
              standaloneBays={standaloneBays}
              defaultDurations={defaultDurations}
              todayStr={todayStr}
              minBookingLeadMinutes={minLeadMinutes}
              bookableWindowDays={bookableWindowDays}
              facilitySlug={org.slug}
              isAuthenticated={true}
              userEmail={auth.profile.email}
              userFullName={auth.profile.full_name}
              userProfileId={auth.profile.id}
              paymentMode={paymentMode}
              locationId={booking.location_id}
              mode="modify"
              originalBooking={{
                id: booking.id,
                confirmationCode: booking.confirmation_code,
                bayId: booking.bay_id,
                bayName,
                date: booking.date,
                startTime: booking.start_time,
                endTime: booking.end_time,
                totalPriceCents: originalPaidCents,
                notes: booking.notes,
                durationMinutes: originalDurationMinutes,
                cardBrand: oldPaymentCardBrand,
                cardLast4: oldPaymentCardLast4,
              }}
              modifyRedirectBase={redirectBase}
            />
          ) : (
            <AvailabilityWidget
              orgId={org.id}
              orgName={org.name}
              timezone={timezone}
              bays={bays}
              todayStr={todayStr}
              minBookingLeadMinutes={minLeadMinutes}
              facilitySlug={org.slug}
              isAuthenticated={true}
              userEmail={auth.profile.email}
              userFullName={auth.profile.full_name}
              userProfileId={auth.profile.id}
              mode="modify"
              paymentMode={paymentMode}
              locationId={booking.location_id}
              originalBooking={{
                id: booking.id,
                confirmationCode: booking.confirmation_code,
                bayId: booking.bay_id,
                bayName,
                date: booking.date,
                startTime: booking.start_time,
                endTime: booking.end_time,
                totalPriceCents: originalPaidCents,
                notes: booking.notes,
                isGuest: booking.is_guest,
                slotIds: slotIds,
                cardBrand: oldPaymentCardBrand,
                cardLast4: oldPaymentCardLast4,
              }}
              modifyRedirectBase={redirectBase}
            />
          )
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
