import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";

export default async function BookingConfirmPage() {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  return (
    <div className="min-h-screen p-8">
      <h1 className="text-3xl font-bold tracking-tight">Confirm Booking</h1>
      <p className="mt-2 text-muted-foreground">
        Review your selected slots and confirm your booking.
      </p>
      {/* Booking confirmation flow — Phase 2 */}
      <div className="mt-8 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Booking confirmation coming soon
      </div>
    </div>
  );
}
