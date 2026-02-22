import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";
import { ChatWidget } from "@/components/chat/chat-widget";
import { OrgHeader } from "@/components/org-header";

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
    .select("id, name, slug, logo_url, cover_photo_url")
    .eq("slug", slug)
    .single();

  const orgName = org?.name ?? slug.replace(/-/g, " ");

  const coverPhotoUrl = org?.cover_photo_url ?? null;
  const logoUrl = org?.logo_url ?? null;

  // Facility landing page
  return (
    <div className="flex min-h-screen flex-col">
      {/* Cover photo hero */}
      {coverPhotoUrl && (
        <div className="relative h-64 w-full sm:h-80">
          <Image
            src={coverPhotoUrl}
            alt={`${orgName} cover`}
            fill
            className="object-cover"
            priority
            unoptimized
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-black/60" />
          <div className="absolute bottom-6 left-6 flex items-center gap-3">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={orgName}
                width={56}
                height={56}
                className="rounded-full object-cover h-14 w-14 border-2 border-white shadow-lg"
                unoptimized
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-primary text-xl font-bold shadow-lg">
                {orgName.charAt(0).toUpperCase()}
              </div>
            )}
            <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-lg capitalize sm:text-4xl">
              {orgName}
            </h1>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col items-center p-8">
        {/* Show org header when no cover photo */}
        {!coverPhotoUrl && (
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt={orgName}
                  width={72}
                  height={72}
                  className="rounded-full object-cover h-18 w-18"
                  unoptimized
                />
              ) : null}
              <h1 className="text-4xl font-bold tracking-tight capitalize">
                {orgName}
              </h1>
            </div>
            <p className="mt-4 text-lg text-muted-foreground">
              Browse availability and book your session
            </p>
          </div>
        )}

        {/* CTA section */}
        <div className={`flex flex-col items-center ${coverPhotoUrl ? "mt-8" : ""}`}>
          {coverPhotoUrl && (
            <p className="mb-6 text-lg text-muted-foreground">
              Browse availability and book your session
            </p>
          )}
          <div className="flex gap-4">
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
    </div>
  );
}
