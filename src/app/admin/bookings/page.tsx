import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

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

export default async function BookingsListPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    status?: string;
    bay?: string;
    q?: string;
    cancelled?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();

  // Load bays for filter dropdown
  const { data: bays } = await supabase
    .from("bays")
    .select("id, name")
    .eq("org_id", org.id)
    .order("sort_order")
    .order("created_at");

  // Build bookings query
  let query = supabase
    .from("bookings")
    .select(
      "id, date, start_time, end_time, total_price_cents, status, confirmation_code, notes, created_at, customer_id, bay_id"
    )
    .eq("org_id", org.id)
    .order("date", { ascending: false })
    .order("start_time", { ascending: false });

  if (params.from) {
    query = query.gte("date", params.from);
  }
  if (params.to) {
    query = query.lte("date", params.to);
  }
  if (params.status && params.status !== "all") {
    query = query.eq("status", params.status);
  }
  if (params.bay) {
    query = query.eq("bay_id", params.bay);
  }

  const { data: bookings } = await query;

  // Look up customer names and bay names
  const customerIds = [
    ...new Set(bookings?.map((b) => b.customer_id) ?? []),
  ];
  let customerMap: Record<string, { full_name: string | null; email: string }> =
    {};
  if (customerIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", customerIds);
    if (profiles) {
      for (const p of profiles) {
        customerMap[p.id] = { full_name: p.full_name, email: p.email };
      }
    }
  }

  const bayMap: Record<string, string> = {};
  if (bays) {
    for (const b of bays) {
      bayMap[b.id] = b.name;
    }
  }

  // Filter by customer search (name or email) — client-side since we join manually
  const search = params.q?.trim().toLowerCase();
  let filtered = bookings ?? [];
  if (search) {
    filtered = filtered.filter((b) => {
      const c = customerMap[b.customer_id];
      if (!c) return false;
      return (
        c.email.toLowerCase().includes(search) ||
        (c.full_name && c.full_name.toLowerCase().includes(search))
      );
    });
  }

  async function cancelBooking(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();
    const bookingId = formData.get("booking_id") as string;

    const { error } = await supabase.rpc("cancel_booking", {
      p_booking_id: bookingId,
    });

    if (error) {
      redirect(
        `/admin/bookings?error=${encodeURIComponent(error.message)}`
      );
    }
    revalidatePath("/admin/bookings");
    redirect("/admin/bookings?cancelled=true");
  }

  // Build filter URL preserving existing params
  function filterUrl(overrides: Record<string, string>) {
    const p = new URLSearchParams();
    const merged = { ...params, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v && k !== "cancelled" && k !== "error") p.set(k, v);
    }
    return `/admin/bookings?${p.toString()}`;
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bookings</h1>
          <p className="mt-2 text-muted-foreground">
            View, filter, and manage all bookings.
          </p>
        </div>
        <Badge variant="secondary">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</Badge>
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

      {/* Filters */}
      <form className="mt-6 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            name="from"
            defaultValue={params.from ?? ""}
            className="h-8 w-36 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            name="to"
            defaultValue={params.to ?? ""}
            className="h-8 w-36 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <select
            name="status"
            defaultValue={params.status ?? "all"}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="all">All</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Bay</Label>
          <select
            name="bay"
            defaultValue={params.bay ?? ""}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">All bays</option>
            {bays?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Customer</Label>
          <Input
            name="q"
            placeholder="Name or email..."
            defaultValue={params.q ?? ""}
            className="h-8 w-40 text-xs"
          />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Filter
        </Button>
        <a href="/admin/bookings">
          <Button type="button" variant="ghost" size="sm">
            Clear
          </Button>
        </a>
      </form>

      {/* Bookings list */}
      <div className="mt-6 space-y-2">
        {filtered.length === 0 && (
          <p className="py-12 text-center text-muted-foreground">
            No bookings found.
          </p>
        )}

        {filtered.map((booking) => {
          const customer = customerMap[booking.customer_id];
          const startDate = new Date(booking.start_time);
          const endDate = new Date(booking.end_time);
          const timeStr = `${startDate.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })} – ${endDate.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}`;

          return (
            <div
              key={booking.id}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">
                    {customer?.full_name || customer?.email || "Unknown"}
                  </p>
                  <Badge
                    variant={
                      booking.status === "confirmed"
                        ? "default"
                        : "secondary"
                    }
                  >
                    {booking.status}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    {booking.confirmation_code}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {new Date(booking.date).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                  {" · "}
                  {timeStr}
                  {" · "}
                  {bayMap[booking.bay_id] ?? "Unknown bay"}
                  {" · "}${(booking.total_price_cents / 100).toFixed(2)}
                </p>
                {booking.notes && (
                  <p className="mt-1 text-xs text-muted-foreground italic">
                    {booking.notes}
                  </p>
                )}
              </div>
              <div className="ml-4 flex items-center gap-2">
                {booking.status === "confirmed" && (
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
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
