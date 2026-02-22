import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";

export default async function BookPage() {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  return (
    <div className="min-h-screen p-8">
      <h1 className="text-3xl font-bold tracking-tight">Availability</h1>
      <p className="mt-2 text-muted-foreground">
        Select a date to view available time slots.
      </p>
      {/* Date picker and availability calendar — Phase 2 */}
      <div className="mt-8 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Availability calendar coming soon
      </div>
    </div>
  );
}
