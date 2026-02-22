import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";
import { ChatWidget } from "@/components/chat/chat-widget";

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
            <Link href="/auth/login?role=super_admin&redirect=/super-admin">
              <Button size="lg">Super Admin Login</Button>
            </Link>
          )}
        </div>
        {auth && (
          <div className="mt-4 flex flex-col items-center gap-1">
            <p className="text-sm text-muted-foreground">
              Signed in as {auth.profile.email}
            </p>
            <SignOutButton variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" />
          </div>
        )}
      </div>
    );
  }

  // Fetch org details for the facility landing page
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();

  const orgName = org?.name ?? slug.replace(/-/g, " ");

  // Facility landing page
  return (
    <div className="flex min-h-screen flex-col items-center p-8">
      <div className="flex flex-1 flex-col items-center justify-center">
        <h1 className="text-4xl font-bold tracking-tight capitalize">
          {orgName}
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
          <div className="mt-4 flex flex-col items-center gap-1">
            <p className="text-sm text-muted-foreground">
              Signed in as {auth.profile.email}
            </p>
            <SignOutButton variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" />
          </div>
        )}
      </div>

      {/* Inline availability assistant */}
      <div className="mt-8 w-full max-w-lg">
        <ChatWidget facilitySlug={slug} orgName={orgName} inline />
      </div>
    </div>
  );
}
