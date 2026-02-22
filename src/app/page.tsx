import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function FacilityHomePage() {
  const slug = await getFacilitySlug();
  const auth = await getAuthUser();

  if (!slug) {
    // No facility context — show platform landing
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-8">
        <h1 className="text-4xl font-bold tracking-tight">PlayBook</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Sports Facility Booking Platform
        </p>
        <div className="mt-8 flex gap-4">
          {auth?.profile.role === "super_admin" ? (
            <Link href="/super-admin">
              <Button size="lg">Go to Dashboard</Button>
            </Link>
          ) : (
            <Link href="/super-admin/auth/login">
              <Button size="lg">Super Admin Login</Button>
            </Link>
          )}
        </div>
        {auth && (
          <p className="mt-4 text-sm text-muted-foreground">
            Signed in as {auth.profile.email}
          </p>
        )}
      </div>
    );
  }

  // Facility landing page
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold tracking-tight capitalize">
        {slug.replace(/-/g, " ")}
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Browse availability and book your session
      </p>
      <div className="mt-8 flex gap-4">
        <Link href="/book">
          <Button size="lg">View Availability</Button>
        </Link>
        {auth ? (
          <Link href="/my-bookings">
            <Button variant="outline" size="lg">
              My Bookings
            </Button>
          </Link>
        ) : (
          <Link href="/auth/login">
            <Button variant="outline" size="lg">
              Sign In
            </Button>
          </Link>
        )}
      </div>
      {auth && (
        <p className="mt-4 text-sm text-muted-foreground">
          Signed in as {auth.profile.email}
        </p>
      )}
    </div>
  );
}
