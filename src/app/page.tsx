import { getFacilitySlug } from "@/lib/facility";
import Link from "next/link";

export default async function FacilityHomePage() {
  const slug = await getFacilitySlug();

  if (!slug) {
    // No facility context — show platform landing
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-8">
        <h1 className="text-4xl font-bold tracking-tight">PlayBook</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Sports Facility Booking Platform
        </p>
        <div className="mt-8 flex gap-4">
          <Link
            href="/super-admin"
            className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Super Admin
          </Link>
        </div>
      </div>
    );
  }

  // Facility landing page (will be populated with real data in Phase 2)
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold tracking-tight capitalize">
        {slug.replace(/-/g, " ")}
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Browse availability and book your session
      </p>
      <div className="mt-8 flex gap-4">
        <Link
          href="/book"
          className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          View Availability
        </Link>
        <Link
          href="/auth/login"
          className="rounded-lg border border-input px-6 py-3 text-sm font-medium hover:bg-accent"
        >
          Sign In
        </Link>
      </div>
    </div>
  );
}
