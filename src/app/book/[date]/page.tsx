import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";

export default async function DateDetailPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const slug = await getFacilitySlug();
  if (!slug) redirect("/");

  const { date } = await params;

  return (
    <div className="min-h-screen p-8">
      <h1 className="text-3xl font-bold tracking-tight">
        Slots for {date}
      </h1>
      <p className="mt-2 text-muted-foreground">
        View all bays and available time slots for this date.
      </p>
      {/* Bay slots grid — Phase 2 */}
      <div className="mt-8 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Bay availability grid coming soon
      </div>
    </div>
  );
}
