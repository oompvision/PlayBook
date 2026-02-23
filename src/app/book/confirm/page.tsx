import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { ensureCustomerOrg } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatTimeInZone } from "@/lib/utils";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function BookingConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  const org = await getOrg();
  if (!org) redirect("/");

  // Ensure customer is linked to this org
  const auth = await ensureCustomerOrg(org.id);
  if (!auth) redirect(`/auth/login?redirect=/book`);

  const params = await searchParams;
  const date = (params.date as string) || "";

  if (!date) redirect("/book");

  // Parse selected bays and slots from URL
  const bayIds: string[] = Array.isArray(params.bay)
    ? params.bay
    : params.bay
      ? [params.bay]
      : [];

  if (bayIds.length === 0) redirect(`/book/${date}`);

  const supabase = await createClient();

  // Get bay details
  const { data: bays } = await supabase
    .from("bays")
    .select("id, name, resource_type")
    .in("id", bayIds);

  const bayMap: Record<string, { name: string; resource_type: string | null }> =
    {};
  if (bays) {
    for (const b of bays) {
      bayMap[b.id] = { name: b.name, resource_type: b.resource_type };
    }
  }

  // Collect all slot IDs and fetch their details
  const allSlotIds: string[] = [];
  const slotIdsByBay: Record<string, string[]> = {};

  for (const bayId of bayIds) {
    const slotsParam = params[`slots_${bayId}`] as string;
    if (!slotsParam) continue;
    const ids = slotsParam.split(",");
    slotIdsByBay[bayId] = ids;
    allSlotIds.push(...ids);
  }

  if (allSlotIds.length === 0) redirect(`/book/${date}`);

  const { data: slots } = await supabase
    .from("bay_schedule_slots")
    .select("id, start_time, end_time, price_cents, status")
    .in("id", allSlotIds)
    .order("start_time");

  const slotMap: Record<
    string,
    {
      start_time: string;
      end_time: string;
      price_cents: number;
      status: string;
    }
  > = {};
  if (slots) {
    for (const s of slots) {
      slotMap[s.id] = s;
    }
  }

  // Check if any slots are no longer available
  const unavailable = slots?.filter((s) => s.status !== "available") || [];

  // Calculate total
  let totalCents = 0;
  if (slots) {
    for (const s of slots) {
      totalCents += s.price_cents;
    }
  }

  async function confirmBooking(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const auth = await ensureCustomerOrg(org.id);
    if (!auth) redirect("/auth/login?redirect=/book");

    const supabase = await createClient();
    const notes = (formData.get("notes") as string) || null;
    const date = formData.get("date") as string;

    // Collect all slot IDs from the form for a single availability check
    const bayIdList = (formData.get("bay_ids") as string).split(",");
    const allFormSlotIds: string[] = [];
    for (const bayId of bayIdList) {
      const slotsParam = formData.get(`slots_${bayId}`) as string;
      if (slotsParam) allFormSlotIds.push(...slotsParam.split(","));
    }

    // Re-validate slot availability before attempting to book
    const { data: freshSlots } = await supabase
      .from("bay_schedule_slots")
      .select("id, status")
      .in("id", allFormSlotIds);

    const unavailableSlots = freshSlots?.filter((s) => s.status !== "available") || [];
    if (unavailableSlots.length > 0) {
      redirect(
        `/book/${date}?error=${encodeURIComponent("One or more selected slots are no longer available. Please choose different time slots.")}`
      );
    }

    // Create one booking per bay
    const results: Array<{ confirmation_code: string; bay_name: string }> = [];

    for (const bayId of bayIdList) {
      const slotIds = (formData.get(`slots_${bayId}`) as string).split(",");

      const { data, error } = await supabase.rpc("create_booking", {
        p_org_id: org.id,
        p_customer_id: auth.profile.id,
        p_bay_id: bayId,
        p_date: date,
        p_slot_ids: slotIds,
        p_notes: notes,
      });

      if (error) {
        redirect(
          `/book/${date}?error=${encodeURIComponent(error.message)}`
        );
      }

      const bayName =
        (formData.get(`bay_name_${bayId}`) as string) || "Facility";

      // The RPC may return a single object or an array when non-consecutive
      // slots are split into separate bookings
      const bookings = Array.isArray(data) ? data : [data];
      for (const result of bookings) {
        const r = result as {
          booking_id: string;
          confirmation_code: string;
          total_price_cents: number;
        };
        results.push({
          confirmation_code: r.confirmation_code,
          bay_name: bayName,
        });
      }
    }

    revalidatePath("/book");
    revalidatePath("/my-bookings");

    // Redirect to My Bookings so the customer sees their reservation
    const codes = results.map((r) => r.confirmation_code).join(",");
    redirect(`/my-bookings?success=true&codes=${codes}`);
  }

  // Success state
  const isSuccess = params.success === "true";
  const codes = (params.codes as string)?.split(",") || [];

  if (isSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle className="text-2xl">Booking Confirmed!</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              Your booking has been confirmed. Save your confirmation code
              {codes.length > 1 ? "s" : ""}.
            </p>
            <div className="space-y-2">
              {codes.map((code) => (
                <div
                  key={code}
                  className="rounded-lg bg-muted p-4 font-mono text-2xl font-bold"
                >
                  {code}
                </div>
              ))}
            </div>
            <div className="flex justify-center gap-3 pt-4">
              <Link href="/my-bookings">
                <Button>View My Bookings</Button>
              </Link>
              <Link href="/book">
                <Button variant="outline">Book Another</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const d = new Date(date + "T12:00:00");
  const dateLabel = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen p-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-4">
          <Link href={`/book/${date}`}>
            <Button variant="ghost" size="sm">
              &larr; Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Confirm Booking
            </h1>
            <p className="mt-1 text-muted-foreground">{dateLabel}</p>
          </div>
        </div>

        {unavailable.length > 0 && (
          <div className="mt-6 rounded-md bg-destructive/10 p-4 text-sm text-destructive">
            Some selected slots are no longer available. Please go back and
            select different slots.
          </div>
        )}

        {/* Booking summary */}
        <div className="mt-6 space-y-4">
          {bayIds.map((bayId) => {
            const bay = bayMap[bayId];
            const baySlotIds = slotIdsByBay[bayId] || [];
            const baySlots = baySlotIds
              .map((id) => slotMap[id])
              .filter(Boolean)
              .sort(
                (a, b) =>
                  new Date(a.start_time).getTime() -
                  new Date(b.start_time).getTime()
              );

            if (baySlots.length === 0) return null;

            const bayTotal = baySlots.reduce(
              (sum, s) => sum + s.price_cents,
              0
            );

            return (
              <Card key={bayId}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {bay?.name || "Facility"}
                    </CardTitle>
                    {bay?.resource_type && (
                      <Badge variant="outline">{bay.resource_type}</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {baySlots.map((slot) => (
                        <div
                          key={slot.start_time}
                          className="flex items-center justify-between text-sm"
                        >
                          <span>
                            {formatTimeInZone(slot.start_time, org!.timezone)}{" "}
                            –{" "}
                            {formatTimeInZone(slot.end_time, org!.timezone)}
                          </span>
                          <span className="text-muted-foreground">
                            ${(slot.price_cents / 100).toFixed(2)}
                          </span>
                        </div>
                    ))}
                    <div className="border-t pt-2 text-sm font-medium">
                      <div className="flex justify-between">
                        <span>Subtotal</span>
                        <span>${(bayTotal / 100).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Total and confirm */}
        <Card className="mt-6">
          <CardContent className="pt-6">
            <div className="mb-4 flex items-center justify-between text-lg font-bold">
              <span>Total</span>
              <span>${(totalCents / 100).toFixed(2)}</span>
            </div>

            <form action={confirmBooking}>
              <input type="hidden" name="date" value={date} />
              <input type="hidden" name="bay_ids" value={bayIds.join(",")} />
              {bayIds.map((bayId) => (
                <div key={bayId}>
                  <input
                    type="hidden"
                    name={`slots_${bayId}`}
                    value={(slotIdsByBay[bayId] || []).join(",")}
                  />
                  <input
                    type="hidden"
                    name={`bay_name_${bayId}`}
                    value={bayMap[bayId]?.name || "Facility"}
                  />
                </div>
              ))}

              <div className="mb-4 space-y-2">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Input
                  id="notes"
                  name="notes"
                  placeholder="Any special requests..."
                />
              </div>

              <p className="mb-4 text-sm text-muted-foreground">
                Booking as {auth.profile.full_name || auth.profile.email}
              </p>

              <SubmitButton
                className="w-full"
                size="lg"
                disabled={unavailable.length > 0}
                pendingText="Booking..."
              >
                Confirm Booking
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
