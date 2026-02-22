import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { ensureCustomerOrg } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function MyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string; error?: string }>;
}) {
  const params = await searchParams;
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  const org = await getOrg();
  if (!org) redirect("/");

  const auth = await ensureCustomerOrg(org.id);
  if (!auth) redirect(`/auth/login?redirect=/my-bookings`);

  const supabase = await createClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      "id, date, start_time, end_time, total_price_cents, status, confirmation_code, notes, bay_id, created_at"
    )
    .eq("org_id", org.id)
    .eq("customer_id", auth.profile.id)
    .order("date", { ascending: false })
    .order("start_time", { ascending: false });

  // Get bay names
  const bayIds = [...new Set(bookings?.map((b) => b.bay_id) ?? [])];
  let bayMap: Record<string, string> = {};
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

  // Split into upcoming and past
  const today = new Date().toISOString().split("T")[0];
  const upcoming = bookings?.filter(
    (b) => b.date >= today && b.status === "confirmed"
  ) ?? [];
  const past = bookings?.filter(
    (b) => b.date < today || b.status === "cancelled"
  ) ?? [];

  async function cancelBooking(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const bookingId = formData.get("booking_id") as string;

    const { error } = await supabase.rpc("cancel_booking", {
      p_booking_id: bookingId,
    });

    if (error) {
      redirect(
        `/my-bookings?error=${encodeURIComponent(error.message)}`
      );
    }
    revalidatePath("/my-bookings");
    redirect("/my-bookings?cancelled=true");
  }

  return (
    <div className="min-h-screen p-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My Bookings</h1>
            <p className="mt-2 text-muted-foreground">
              View your upcoming and past bookings.
            </p>
          </div>
          <Link href="/book">
            <Button>Book a Session</Button>
          </Link>
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

        {/* Upcoming */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold">Upcoming</h2>
          {upcoming.length === 0 && (
            <p className="mt-4 py-8 text-center text-muted-foreground">
              No upcoming bookings.{" "}
              <Link href="/book" className="text-primary hover:underline">
                Book a session
              </Link>
            </p>
          )}
          <div className="mt-3 space-y-2">
            {upcoming.map((booking) => {
              const start = new Date(booking.start_time);
              const end = new Date(booking.end_time);
              const d = new Date(booking.date + "T12:00:00");
              const dateStr = d.toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              });
              const timeStr = `${start.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })} – ${end.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}`;

              return (
                <div
                  key={booking.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{dateStr}</p>
                      <Badge variant="default">Confirmed</Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {timeStr} · {bayMap[booking.bay_id] || "Bay"} · $
                      {(booking.total_price_cents / 100).toFixed(2)}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {booking.confirmation_code}
                    </p>
                    {booking.notes && (
                      <p className="mt-1 text-xs italic text-muted-foreground">
                        {booking.notes}
                      </p>
                    )}
                  </div>
                  <form action={cancelBooking}>
                    <input
                      type="hidden"
                      name="booking_id"
                      value={booking.id}
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10"
                    >
                      Cancel
                    </Button>
                  </form>
                </div>
              );
            })}
          </div>
        </div>

        {/* Past */}
        {past.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold">Past & Cancelled</h2>
            <div className="mt-3 space-y-2">
              {past.map((booking) => {
                const start = new Date(booking.start_time);
                const end = new Date(booking.end_time);
                const d = new Date(booking.date + "T12:00:00");
                const dateStr = d.toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                });
                const timeStr = `${start.toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })} – ${end.toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}`;

                return (
                  <div
                    key={booking.id}
                    className="flex items-center justify-between rounded-lg border p-4 opacity-60"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{dateStr}</p>
                        <Badge
                          variant={
                            booking.status === "cancelled"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {booking.status === "cancelled"
                            ? "Cancelled"
                            : "Completed"}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {timeStr} · {bayMap[booking.bay_id] || "Bay"} · $
                        {(booking.total_price_cents / 100).toFixed(2)}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {booking.confirmation_code}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
