import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { ensureCustomerOrg } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button"
import { getTodayInTimezone } from "@/lib/utils";
import { SignOutButton } from "@/components/sign-out-button";
import { OrgHeader } from "@/components/org-header";
import { MyBookingsList } from "@/components/my-bookings-list";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, logo_url")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function MyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string; error?: string; success?: string; codes?: string; modified?: string; old?: string; new?: string }>;
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
      "id, date, start_time, end_time, total_price_cents, status, confirmation_code, notes, bay_id, created_at, modified_from"
    )
    .eq("org_id", org.id)
    .eq("customer_id", auth.profile.id)
    .order("date", { ascending: false })
    .order("start_time", { ascending: false });

  // Resolve modified_from confirmation codes for display
  const modifiedFromIds = [
    ...new Set(bookings?.map((b) => b.modified_from).filter(Boolean) ?? []),
  ];
  const modifiedFromCodeMap: Record<string, string> = {};
  if (modifiedFromIds.length > 0) {
    const { data: originals } = await supabase
      .from("bookings")
      .select("id, confirmation_code")
      .in("id", modifiedFromIds);
    if (originals) {
      for (const o of originals) {
        modifiedFromCodeMap[o.id] = o.confirmation_code;
      }
    }
  }

  // Attach modified_from_code to each booking
  const enrichedBookings = bookings?.map((b) => ({
    ...b,
    modified_from_code: b.modified_from
      ? modifiedFromCodeMap[b.modified_from] ?? null
      : null,
  })) ?? [];

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

  // Split into upcoming and past (using facility timezone)
  const today = getTodayInTimezone(org.timezone);
  const upcoming = enrichedBookings.filter(
    (b) => b.date >= today && b.status === "confirmed"
  );
  const past = enrichedBookings.filter(
    (b) => b.date < today || b.status === "cancelled"
  );

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
          <OrgHeader name={org.name} logoUrl={org.logo_url} />
          <div className="flex items-center gap-2">
            <Link href="/">
              <Button>Book a Session</Button>
            </Link>
            <SignOutButton variant="outline" size="sm" className="" />
          </div>
        </div>

        <div className="mt-4">
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
            {params.old && params.new && (
              <span>
                <span className="font-mono font-semibold">{params.old}</span>
                {" "}has been replaced with{" "}
                <span className="font-mono font-semibold">{params.new}</span>
              </span>
            )}
          </div>
        )}

        <MyBookingsList
          upcoming={upcoming}
          past={past}
          bayMap={bayMap}
          timezone={org.timezone}
          cancelAction={cancelBooking}
        />
      </div>
    </div>
  );
}
