import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SignOutButton } from "@/components/sign-out-button";
import { OrgHeader } from "@/components/org-header";
import { getTodayInTimezone, toTimestamp } from "@/lib/utils";

export default async function BookPage() {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  const auth = await getAuthUser();
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, logo_url")
    .eq("slug", slug)
    .single();

  if (!org) redirect("/");

  // Build next 14 days using the facility's timezone
  const todayStr = getTodayInTimezone(org.timezone);
  const dates: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(todayStr + "T12:00:00");
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }

  // Get available slot counts per date using timezone-aware bounds
  // so that evening slots don't bleed into the next day's count
  const lastDay = new Date(dates[dates.length - 1] + "T12:00:00");
  lastDay.setDate(lastDay.getDate() + 1);
  const dayAfterLastStr = lastDay.toISOString().split("T")[0];

  const rangeStart = toTimestamp(dates[0], "00:00:00", org.timezone);
  const rangeEnd = toTimestamp(dayAfterLastStr, "00:00:00", org.timezone);

  const { data: slots } = await supabase
    .from("bay_schedule_slots")
    .select("id, start_time, status, bay_schedule_id")
    .eq("org_id", org.id)
    .eq("status", "available")
    .gte("start_time", rangeStart)
    .lt("start_time", rangeEnd);

  // Count available slots per date (extract date in facility timezone)
  const availByDate: Record<string, number> = {};
  if (slots) {
    for (const slot of slots) {
      const slotDate = new Date(slot.start_time).toLocaleDateString("en-CA", {
        timeZone: org.timezone,
      }); // en-CA gives YYYY-MM-DD format
      availByDate[slotDate] = (availByDate[slotDate] || 0) + 1;
    }
  }

  return (
    <div className="min-h-screen p-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between">
          <div>
            <OrgHeader name={org.name} logoUrl={org.logo_url} />
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
              <SignOutButton variant="outline" size="sm" className="" />
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
