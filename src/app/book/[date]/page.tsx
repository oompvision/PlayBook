import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import SlotPicker from "./slot-picker";

export default async function DateDetailPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  const { date } = await params;
  const auth = await getAuthUser();
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();

  if (!org) redirect("/");

  // Get active bays
  const { data: bays } = await supabase
    .from("bays")
    .select("id, name, resource_type")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");

  // Get all slots for this date
  const { data: allSlots } = await supabase
    .from("bay_schedule_slots")
    .select("id, start_time, end_time, price_cents, status, bay_schedule_id")
    .eq("org_id", org.id)
    .gte("start_time", `${date}T00:00:00`)
    .lte("start_time", `${date}T23:59:59`)
    .order("start_time");

  // Get bay_schedule records to map slots to bays
  const { data: schedules } = await supabase
    .from("bay_schedules")
    .select("id, bay_id")
    .eq("org_id", org.id)
    .eq("date", date);

  const scheduleToBay: Record<string, string> = {};
  if (schedules) {
    for (const s of schedules) {
      scheduleToBay[s.id] = s.bay_id;
    }
  }

  // Group slots by bay
  const slotsByBay: Record<
    string,
    Array<{
      id: string;
      start_time: string;
      end_time: string;
      price_cents: number;
      status: string;
    }>
  > = {};

  if (allSlots) {
    for (const slot of allSlots) {
      const bayId = scheduleToBay[slot.bay_schedule_id];
      if (!bayId) continue;
      if (!slotsByBay[bayId]) slotsByBay[bayId] = [];
      slotsByBay[bayId].push({
        id: slot.id,
        start_time: slot.start_time,
        end_time: slot.end_time,
        price_cents: slot.price_cents,
        status: slot.status,
      });
    }
  }

  const d = new Date(date + "T12:00:00");
  const dateLabel = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen p-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-4">
          <Link href="/book">
            <Button variant="ghost" size="sm">
              &larr; Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{dateLabel}</h1>
            <p className="mt-1 text-muted-foreground">
              {auth
                ? "Select one or more time slots, then continue to book."
                : "Sign in to book a time slot."}
            </p>
          </div>
        </div>

        {!auth && (
          <div className="mt-6 rounded-lg border border-dashed p-6 text-center">
            <p className="text-muted-foreground">
              You need to sign in to make a booking.
            </p>
            <Link href={`/auth/login?redirect=/book/${date}`}>
              <Button className="mt-3">Sign In</Button>
            </Link>
            <p className="mt-2 text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link
                href="/auth/signup"
                className="font-medium text-primary hover:underline"
              >
                Sign up
              </Link>
            </p>
          </div>
        )}

        <SlotPicker
          date={date}
          bays={bays ?? []}
          slotsByBay={slotsByBay}
          isAuthenticated={!!auth}
        />
      </div>
    </div>
  );
}
