import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default async function BookPage() {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  const auth = await getAuthUser();
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();

  if (!org) redirect("/");

  // Build next 14 days
  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }

  // Get available slot counts per date
  const { data: slots } = await supabase
    .from("bay_schedule_slots")
    .select("id, start_time, status, bay_schedule_id")
    .eq("org_id", org.id)
    .eq("status", "available")
    .gte("start_time", `${dates[0]}T00:00:00`)
    .lte("start_time", `${dates[dates.length - 1]}T23:59:59`);

  // Count available slots per date
  const availByDate: Record<string, number> = {};
  if (slots) {
    for (const slot of slots) {
      const slotDate = new Date(slot.start_time).toISOString().split("T")[0];
      availByDate[slotDate] = (availByDate[slotDate] || 0) + 1;
    }
  }

  return (
    <div className="min-h-screen p-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight capitalize">
              {org.name}
            </h1>
            <p className="mt-2 text-muted-foreground">
              Select a date to view available time slots.
            </p>
          </div>
          {auth ? (
            <div className="flex items-center gap-2">
              <Link href="/my-bookings">
                <Button variant="outline" size="sm">
                  My Bookings
                </Button>
              </Link>
            </div>
          ) : (
            <Link href="/auth/login?redirect=/book">
              <Button variant="outline" size="sm">
                Sign In
              </Button>
            </Link>
          )}
        </div>

        <div className="mt-8 grid gap-2">
          {dates.map((date) => {
            const d = new Date(date + "T12:00:00");
            const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
            const monthDay = d.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
            const avail = availByDate[date] || 0;
            const isToday = date === dates[0];

            return (
              <Link key={date} href={`/book/${date}`}>
                <div
                  className={`flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent ${
                    avail === 0 ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 text-center">
                      <p className="text-xs font-medium uppercase text-muted-foreground">
                        {dayName}
                      </p>
                      <p className="text-lg font-bold">
                        {d.getDate()}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium">
                        {monthDay}
                        {isToday && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            Today
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div>
                    {avail > 0 ? (
                      <Badge variant="default">
                        {avail} slot{avail !== 1 ? "s" : ""} available
                      </Badge>
                    ) : (
                      <Badge variant="secondary">No availability</Badge>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
