import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";

export default async function MyBookingsPage() {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  return (
    <div className="min-h-screen p-8">
      <h1 className="text-3xl font-bold tracking-tight">My Bookings</h1>
      <p className="mt-2 text-muted-foreground">
        View your upcoming and past bookings.
      </p>
      {/* Customer bookings list — Phase 2 */}
      <div className="mt-8 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Bookings list coming soon
      </div>
    </div>
  );
}
