import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser, ensureCustomerOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveLocationId, getOrgLocations } from "@/lib/location";
import { EventsFeed } from "@/components/events/events-feed";

export default async function EventsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams?: Promise<{ [key: string]: string | undefined }>;
}) {
  const slug = await getFacilitySlug();
  const auth = await getAuthUser();

  if (!slug) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 text-center">
        <p className="text-muted-foreground">No facility context found.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, events_enabled, locations_enabled")
    .eq("slug", slug)
    .single();

  if (!org || !(org.events_enabled ?? true)) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 text-center">
        <p className="text-muted-foreground">Events are not available.</p>
      </div>
    );
  }

  const timezone = org.timezone || "America/New_York";

  if (auth) {
    await ensureCustomerOrg(org.id);
  }

  // Fetch payment mode
  let paymentMode = "none";
  const serviceClient = createServiceClient();
  const { data: paymentSettings } = await serviceClient
    .from("org_payment_settings")
    .select("payment_mode, stripe_onboarding_complete")
    .eq("org_id", org.id)
    .single();

  if (
    paymentSettings?.payment_mode &&
    paymentSettings.payment_mode !== "none" &&
    paymentSettings.stripe_onboarding_complete
  ) {
    paymentMode = paymentSettings.payment_mode;
  }

  // Resolve membership status
  let isMember = false;
  if (auth) {
    const { data: membership } = await supabase
      .from("customer_memberships")
      .select("id")
      .eq("user_id", auth.profile.id)
      .eq("org_id", org.id)
      .eq("status", "active")
      .maybeSingle();
    isMember = !!membership;
  }

  // Resolve location
  const searchParams = searchParamsPromise ? await searchParamsPromise : {};
  let activeLocationId: string | null = null;
  if (org.locations_enabled) {
    const locations = await getOrgLocations(org.id);
    activeLocationId = await resolveLocationId(
      org.id,
      searchParams?.location,
      locations
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <EventsFeed
        orgId={org.id}
        timezone={timezone}
        isAuthenticated={!!auth}
        isMember={isMember}
        userId={auth?.profile.id}
        paymentMode={paymentMode}
        locationId={activeLocationId}
      />
      {/* Fallback if no events */}
    </div>
  );
}
