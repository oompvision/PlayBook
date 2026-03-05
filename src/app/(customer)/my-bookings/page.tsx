import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getFacilitySlug } from "@/lib/facility";
import { ensureCustomerOrg } from "@/lib/auth";
import { createNotification, notifyOrgAdmins } from "@/lib/notifications";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatTimeInZone, getVisualBookingStatus } from "@/lib/utils";
import { MyBookingsList } from "@/components/my-bookings-list";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, logo_url, locations_enabled")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function MyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string; error?: string; success?: string; codes?: string; modified?: string; old?: string; new?: string; booking?: string }>;
}) {
  const params = await searchParams;
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  const org = await getOrg();
  if (!org) redirect("/");

  const auth = await ensureCustomerOrg(org.id);
  if (!auth) redirect(`/auth/login?redirect=/my-bookings`);

  // Fetch payment settings for cancellation window info
  const service = createServiceClient();
  const { data: paymentSettings } = await service
    .from("org_payment_settings")
    .select("payment_mode, cancellation_window_hours, stripe_onboarding_complete")
    .eq("org_id", org.id)
    .single();

  const cancellationWindowHours = paymentSettings?.cancellation_window_hours ?? 24;
  const paymentMode =
    paymentSettings?.payment_mode !== "none" &&
    paymentSettings?.stripe_onboarding_complete
      ? paymentSettings.payment_mode
      : "none";

  const supabase = await createClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      "id, date, start_time, end_time, total_price_cents, status, confirmation_code, notes, bay_id, created_at, modified_from, location_id, locations:location_id(name)"
    )
    .eq("org_id", org.id)
    .eq("customer_id", auth.profile.id)
    .order("date", { ascending: false })
    .order("start_time", { ascending: false });

  // Resolve modified_from booking details for display
  const modifiedFromIds = [
    ...new Set(bookings?.map((b) => b.modified_from).filter(Boolean) ?? []),
  ];
  const modifiedFromInfoMap: Record<string, { start_time: string; end_time: string; date: string; bay_id: string }> = {};
  if (modifiedFromIds.length > 0) {
    const { data: originals } = await supabase
      .from("bookings")
      .select("id, start_time, end_time, date, bay_id")
      .in("id", modifiedFromIds);
    if (originals) {
      for (const o of originals) {
        modifiedFromInfoMap[o.id] = { start_time: o.start_time, end_time: o.end_time, date: o.date, bay_id: o.bay_id };
      }
    }
  }

  // Get bay names (include bay IDs from modified_from bookings)
  const modifiedFromBayIds = Object.values(modifiedFromInfoMap).map((i) => i.bay_id);
  const bayIds = [...new Set([...(bookings?.map((b) => b.bay_id) ?? []), ...modifiedFromBayIds])];
  const bayMap: Record<string, string> = {};
  if (bayIds.length > 0) {
    const { data: bays } = await supabase
      .from("bays")
      .select("id, name")
      .in("id", bayIds);
    if (bays) {
      for (const b of bays) {
        bayMap[b.id] = b.name;
      }
    }
  }

  // Attach modified_from_info and location name to each booking
  const enrichedBookings = bookings?.map((b) => {
    const info = b.modified_from ? modifiedFromInfoMap[b.modified_from] ?? null : null;
    const locationName = org.locations_enabled
      ? (b.locations as unknown as { name: string } | null)?.name ?? null
      : null;
    return {
      ...b,
      locationName,
      modified_from_info: info ? {
        startTime: info.start_time,
        endTime: info.end_time,
        date: info.date,
        bayName: bayMap[info.bay_id] || "Facility",
      } : null,
    };
  }) ?? [];

  // Look up old and new booking details for the modify toast
  let toastOldLabel = "";
  let toastNewLabel = "";
  if (params.modified && params.old && params.new) {
    const codes = [params.old, params.new];
    const { data: toastBookings } = await supabase
      .from("bookings")
      .select("confirmation_code, start_time, end_time, date, bay_id")
      .in("confirmation_code", codes);
    if (toastBookings) {
      for (const tb of toastBookings) {
        const timeRange = `${formatTimeInZone(tb.start_time, org.timezone)} – ${formatTimeInZone(tb.end_time, org.timezone)}`;
        const dateLabel = new Date(tb.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const bayLabel = bayMap[tb.bay_id] || "Facility";
        const label = `${timeRange}, ${dateLabel}, ${bayLabel}`;
        if (tb.confirmation_code === params.old) toastOldLabel = label;
        if (tb.confirmation_code === params.new) toastNewLabel = label;
      }
    }
  }

  // Fetch user's event registrations
  const { data: eventRegistrations } = await supabase
    .from("event_registrations")
    .select(`
      id,
      event_id,
      status,
      waitlist_position,
      payment_status,
      registered_at,
      cancelled_at,
      promoted_at,
      events:event_id!inner (
        name,
        start_time,
        end_time,
        price_cents,
        capacity,
        status
      )
    `)
    .eq("org_id", org.id)
    .eq("user_id", auth.profile.id)
    .order("registered_at", { ascending: false });

  const activeEventRegs = eventRegistrations?.filter(
    (r) => r.status !== "cancelled" && r.events
  ) ?? [];
  const pastEventRegs = eventRegistrations?.filter(
    (r) => r.status === "cancelled" || (r.events && new Date(r.events.end_time) < new Date())
  ) ?? [];

  // Split into upcoming+active vs past+cancelled (using visual status)
  const upcoming = enrichedBookings.filter((b) => {
    const vs = getVisualBookingStatus(b.status, b.start_time, b.end_time);
    return vs === "confirmed" || vs === "active";
  });
  const past = enrichedBookings.filter((b) => {
    const vs = getVisualBookingStatus(b.status, b.start_time, b.end_time);
    return vs === "completed" || vs === "cancelled";
  });

  async function cancelBooking(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const bookingId = formData.get("booking_id") as string;

    // Get booking details before cancelling (for notification)
    const service = createServiceClient();
    const { data: bookingInfo } = await service
      .from("bookings")
      .select("id, org_id, customer_id, bay_id, date, start_time, end_time, confirmation_code")
      .eq("id", bookingId)
      .single();

    const { error } = await supabase.rpc("cancel_booking", {
      p_booking_id: bookingId,
    });

    if (error) {
      redirect(
        `/my-bookings?error=${encodeURIComponent(error.message)}`
      );
    }

    // Send cancellation notifications (fire-and-forget)
    if (bookingInfo) {
      const { data: bookingOrg } = await service.from("organizations").select("name, timezone").eq("id", bookingInfo.org_id).single();
      const { data: bookingBay } = await service.from("bays").select("name").eq("id", bookingInfo.bay_id).single();
      const { data: customerProfile } = await service.from("profiles").select("email, full_name").eq("id", bookingInfo.customer_id).single();

      const tz = bookingOrg?.timezone ?? "America/New_York";
      const bayName = bookingBay?.name ?? "Facility";
      const orgName = bookingOrg?.name ?? "EZBooker";
      const timeStr = `${formatTimeInZone(bookingInfo.start_time, tz)} – ${formatTimeInZone(bookingInfo.end_time, tz)}`;
      const dateStr = new Date(bookingInfo.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const code = bookingInfo.confirmation_code;

      createNotification({
        orgId: bookingInfo.org_id,
        recipientId: bookingInfo.customer_id,
        recipientType: "customer",
        type: "booking_canceled",
        title: "Booking Cancelled",
        message: `Your booking ${code} (${bayName}, ${dateStr}, ${timeStr}) has been cancelled.`,
        link: `/my-bookings?booking=${code}`,
        recipientEmail: customerProfile?.email,
        recipientName: customerProfile?.full_name ?? undefined,
        orgName,
      }).catch(() => {});

      notifyOrgAdmins(bookingInfo.org_id, orgName, {
        type: "booking_canceled",
        title: `Booking Cancelled: ${code}`,
        message: `${customerProfile?.full_name || customerProfile?.email || "Customer"} cancelled ${bayName} — ${dateStr}, ${timeStr}`,
        link: `/admin/bookings?booking=${code}`,
      }).catch(() => {});
    }

    revalidatePath("/my-bookings");
    redirect("/my-bookings?cancelled=true");
  }

  async function cancelEventRegistration(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const regId = formData.get("registration_id") as string;

    const { error } = await supabase.rpc("cancel_event_registration", {
      p_registration_id: regId,
    });

    if (error) {
      redirect(`/my-bookings?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/my-bookings");
    redirect("/my-bookings?cancelled=true");
  }

  return (
    <div className="flex-1 p-8">
      <div className="mx-auto max-w-2xl">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Bookings</h1>
          <p className="mt-2 text-muted-foreground">
            View your upcoming and past bookings.
          </p>
        </div>

        {params.error && (
          <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {params.error}
          </div>
        )}
        {params.cancelled && (
          <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
            Booking cancelled successfully.
          </div>
        )}
        {params.success && (
          <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
            Booking confirmed!{" "}
            {params.codes && (
              <span>
                Confirmation code{params.codes.includes(",") ? "s" : ""}:{" "}
                <span className="font-mono font-semibold">{params.codes}</span>
              </span>
            )}
          </div>
        )}
        {params.modified && (
          <div className="mt-4 rounded-md bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            Booking modified successfully!{" "}
            {toastOldLabel && toastNewLabel && (
              <span>
                <span className="font-semibold">{toastOldLabel}</span>
                {" "}has been replaced with{" "}
                <span className="font-semibold">{toastNewLabel}</span>
              </span>
            )}
          </div>
        )}

        <MyBookingsList
          upcoming={upcoming}
          past={past}
          bayMap={bayMap}
          timezone={org.timezone}
          orgId={org.id}
          initialBookingCode={params.booking}
          cancelAction={cancelBooking}
          cancellationWindowHours={cancellationWindowHours}
          paymentMode={paymentMode}
        />

        {/* My Events Section */}
        {(activeEventRegs.length > 0 || pastEventRegs.length > 0) && (
          <div className="mt-10">
            <h2 className="text-2xl font-bold tracking-tight">My Events</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your event registrations.
            </p>

            {activeEventRegs.length > 0 && (
              <div className="mt-4 space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Upcoming
                </h3>
                {activeEventRegs.map((reg) => {
                  const event = reg.events as {
                    name: string;
                    start_time: string;
                    end_time: string;
                    price_cents: number;
                  } | null;
                  if (!event) return null;
                  const startStr = new Intl.DateTimeFormat("en-US", {
                    timeZone: org.timezone,
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(event.start_time));
                  const endStr = new Intl.DateTimeFormat("en-US", {
                    timeZone: org.timezone,
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(event.end_time));

                  const statusColor = reg.status === "confirmed"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : reg.status === "waitlisted"
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                      : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";

                  return (
                    <div
                      key={reg.id}
                      className="rounded-lg border p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                              Event
                            </span>
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColor}`}>
                              {reg.status === "pending_payment" ? "Payment Pending" : reg.status}
                              {reg.waitlist_position ? ` #${reg.waitlist_position}` : ""}
                            </span>
                          </div>
                          <p className="mt-1.5 font-semibold">{event.name}</p>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {startStr} – {endStr}
                          </p>
                          {event.price_cents > 0 && (
                            <p className="mt-0.5 text-sm font-medium">
                              ${(event.price_cents / 100).toFixed(2)}
                            </p>
                          )}
                        </div>
                        {reg.status !== "cancelled" && (
                          <form action={cancelEventRegistration}>
                            <input type="hidden" name="registration_id" value={reg.id} />
                            <button
                              type="submit"
                              className="rounded-md border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              Cancel
                            </button>
                          </form>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {pastEventRegs.length > 0 && (
              <div className="mt-6 space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Past
                </h3>
                {pastEventRegs.map((reg) => {
                  const event = reg.events as {
                    name: string;
                    start_time: string;
                    end_time: string;
                    price_cents: number;
                  } | null;
                  if (!event) return null;
                  const startStr = new Intl.DateTimeFormat("en-US", {
                    timeZone: org.timezone,
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(event.start_time));

                  return (
                    <div
                      key={reg.id}
                      className="rounded-lg border p-4 opacity-60"
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                          {reg.status === "cancelled" ? "Cancelled" : "Completed"}
                        </span>
                      </div>
                      <p className="mt-1.5 font-semibold">{event.name}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{startStr}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
