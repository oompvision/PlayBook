import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser, ensureCustomerOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getTodayInTimezone } from "@/lib/utils";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";
import { OrgHeader } from "@/components/org-header";
import { AuthModal } from "@/components/auth-modal";
import { AvailabilityWidget } from "@/components/availability-widget";
import { AdminLoginForm } from "@/components/admin-login-form";
import { UserCircle } from "lucide-react";
import { NotificationBell } from "@/components/notifications/notification-bell";

export default async function FacilityHomePage() {
  const slug = await getFacilitySlug();
  const auth = await getAuthUser();

  if (!slug) {
    // No facility context — show platform landing with admin login
    const isAdmin = auth?.profile.role === "admin";
    const isSuperAdmin = auth?.profile.role === "super_admin";

    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-8">
        <Image
          src="/logos/ezbooker-logo-light.svg"
          alt="EZ Booker"
          width={240}
          height={54}
          priority
          className="mb-2"
        />
        <p className="mb-8 text-lg text-muted-foreground">
          Sports Facility Booking Platform
        </p>

        {isSuperAdmin ? (
          <div className="flex flex-col items-center gap-4">
            <Link href="/super-admin">
              <Button size="lg">Go to Dashboard</Button>
            </Link>
            <div className="flex flex-col items-center gap-1">
              <p className="text-sm text-muted-foreground">
                Signed in as {auth.profile.email}
              </p>
              <SignOutButton variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" />
            </div>
          </div>
        ) : isAdmin && auth.profile.org_id ? (
          <div className="flex flex-col items-center gap-4">
            <a href={`/api/admin/enter/${auth.profile.org_id}`}>
              <Button size="lg">Go to Dashboard</Button>
            </a>
            <div className="flex flex-col items-center gap-1">
              <p className="text-sm text-muted-foreground">
                Signed in as {auth.profile.email}
              </p>
              <SignOutButton variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" />
            </div>
          </div>
        ) : (
          <>
            <AdminLoginForm />
            {auth && (
              <div className="mt-4 flex flex-col items-center gap-1">
                <p className="text-sm text-muted-foreground">
                  Signed in as {auth.profile.email}
                </p>
                <SignOutButton variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" />
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // Fetch org details for the facility landing page
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, logo_url, cover_photo_url, timezone, min_booking_lead_minutes")
    .eq("slug", slug)
    .single();

  const orgName = org?.name ?? slug.replace(/-/g, " ");
  const coverPhotoUrl = org?.cover_photo_url ?? null;
  const logoUrl = org?.logo_url ?? null;
  const timezone = org?.timezone ?? "America/New_York";
  const minBookingLeadMinutes = org?.min_booking_lead_minutes ?? 15;

  // Fetch active bays for the desktop availability widget
  const { data: bays } = org
    ? await supabase
        .from("bays")
        .select("id, name, resource_type")
        .eq("org_id", org.id)
        .eq("is_active", true)
        .order("sort_order")
        .order("created_at")
    : { data: null };

  // Link customer to org on first visit (replaces logic from removed /book/confirm page)
  if (auth && org) {
    await ensureCustomerOrg(org.id);
  }

  // Fetch payment mode + cancellation window (uses service client to bypass RLS for customers)
  let paymentMode = "none";
  let cancellationWindowHours = 24;
  if (org) {
    const serviceClient = createServiceClient();
    const { data: paymentSettings } = await serviceClient
      .from("org_payment_settings")
      .select("payment_mode, stripe_onboarding_complete, cancellation_window_hours")
      .eq("org_id", org.id)
      .single();

    if (
      paymentSettings?.payment_mode &&
      paymentSettings.payment_mode !== "none" &&
      paymentSettings.stripe_onboarding_complete
    ) {
      paymentMode = paymentSettings.payment_mode;
    }
    if (paymentSettings?.cancellation_window_hours != null) {
      cancellationWindowHours = paymentSettings.cancellation_window_hours;
    }
  }

  const todayStr = getTodayInTimezone(timezone);

  return (
    <div className="flex min-h-screen flex-col">
      {/* =========== DESKTOP LAYOUT =========== */}
      <div className="hidden lg:flex lg:min-h-screen lg:flex-col">
        {/* Top Navigation Bar */}
        <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
            <OrgHeader name={orgName} logoUrl={logoUrl} />
            <div className="flex items-center gap-3">
              {auth ? (
                <>
                  <Link href="/my-bookings">
                    <Button variant="ghost" size="sm">
                      My Bookings
                    </Button>
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {auth.profile.email}
                  </span>
                  <NotificationBell userId={auth.user.id} viewAllHref="/notifications" />
                  <Link
                    href="/account"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/20"
                    title="My Account"
                  >
                    <UserCircle className="h-5 w-5" />
                  </Link>
                  <SignOutButton variant="outline" size="sm" />
                </>
              ) : (
                <AuthModal />
              )}
            </div>
          </div>
        </header>

        {/* Hero Section */}
        {coverPhotoUrl ? (
          <div className="relative h-48 w-full">
            <Image
              src={coverPhotoUrl}
              alt={`${orgName} cover`}
              fill
              className="object-cover"
              priority
              unoptimized
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/40" />
            <div className="absolute bottom-4 left-0 right-0">
              <div className="mx-auto max-w-6xl px-6">
                <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-lg capitalize">
                  {orgName}
                </h1>
                <p className="mt-1 text-sm text-white/80">
                  Browse availability and book your session
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="border-b bg-muted/30 py-8">
            <div className="mx-auto max-w-6xl px-6">
              <h1 className="text-2xl font-bold tracking-tight capitalize">
                {orgName}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Browse availability and book your session
              </p>
            </div>
          </div>
        )}

        {/* Availability Widget */}
        <div className="flex-1 py-6">
          <div className="mx-auto max-w-6xl px-6">
            {org && bays && bays.length > 0 ? (
              <AvailabilityWidget
                orgId={org.id}
                orgName={orgName}
                timezone={timezone}
                bays={bays}
                todayStr={todayStr}
                minBookingLeadMinutes={minBookingLeadMinutes}
                facilitySlug={slug}
                isAuthenticated={!!auth}
                userEmail={auth?.profile.email}
                userFullName={auth?.profile.full_name}
                userProfileId={auth?.profile.id}
                paymentMode={paymentMode}
                cancellationWindowHours={cancellationWindowHours}
              />
            ) : (
              <div className="rounded-xl border bg-card p-12 text-center">
                <p className="text-muted-foreground">
                  No facilities are currently available for booking.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* =========== MOBILE LAYOUT =========== */}
      <div className="flex min-h-screen flex-col lg:hidden">
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

        <div className="flex flex-1 flex-col p-6">
          {/* Show org header when no cover photo */}
          {!coverPhotoUrl && (
            <div className="mb-6 flex flex-col items-center text-center">
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
                <h1 className="text-3xl font-bold tracking-tight capitalize">
                  {orgName}
                </h1>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Browse availability and book your session
              </p>
            </div>
          )}

          {/* Navigation / auth row */}
          <div className="mb-6 flex items-center justify-between">
            <div className="flex gap-3">
              {auth ? (
                <Link href="/my-bookings">
                  <Button variant="outline" size="sm">
                    My Bookings
                  </Button>
                </Link>
              ) : (
                <AuthModal />
              )}
            </div>
            {auth && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {auth.profile.email}
                </span>
                <Link
                  href="/account"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/20"
                  title="My Account"
                >
                  <UserCircle className="h-4 w-4" />
                </Link>
                <SignOutButton variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" />
              </div>
            )}
          </div>

          {/* Mobile availability widget with embedded chat */}
          {org && bays && bays.length > 0 ? (
            <AvailabilityWidget
              orgId={org.id}
              orgName={orgName}
              timezone={timezone}
              bays={bays}
              todayStr={todayStr}
              minBookingLeadMinutes={minBookingLeadMinutes}
              facilitySlug={slug}
              isAuthenticated={!!auth}
              paymentMode={paymentMode}
              cancellationWindowHours={cancellationWindowHours}
            />
          ) : (
            <div className="rounded-xl border bg-card p-8 text-center">
              <p className="text-muted-foreground">
                No facilities are currently available for booking.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
