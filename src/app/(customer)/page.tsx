import { getFacilitySlug } from "@/lib/facility";
import { getAuthUser, ensureCustomerOrg } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getTodayInTimezone } from "@/lib/utils";
import { resolveLocationId, getOrgLocations, isPreferredLocationDeactivated } from "@/lib/location";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";
import { AvailabilityWidget } from "@/components/availability-widget";
import { DynamicAvailabilityWidget } from "@/components/dynamic-availability-widget";
import { AdminLoginForm } from "@/components/admin-login-form";
import { MarketingHomepage, type DemoOrgData } from "@/components/marketing/marketing-homepage";

const DEMO_ORG_SLUG = "demo";

async function fetchDemoOrgData(): Promise<DemoOrgData | null> {
  try {
    const supabase = await createClient();
    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, slug, timezone, min_booking_lead_minutes, bookable_window_days")
      .eq("slug", DEMO_ORG_SLUG)
      .single();

    if (!org) return null;

    const [{ data: bays }, { data: baysWithRates }] = await Promise.all([
      supabase
        .from("bays")
        .select("id, name, resource_type")
        .eq("org_id", org.id)
        .eq("is_active", true)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("bays")
        .select("id, name, resource_type, hourly_rate_cents")
        .eq("org_id", org.id)
        .eq("is_active", true)
        .order("sort_order")
        .order("created_at"),
    ]);

    if (!bays || bays.length === 0) return null;

    // Fetch facility groups, group members, and rules
    const [{ data: groups }, { data: members }, { data: rules }] = await Promise.all([
      supabase
        .from("facility_groups")
        .select("id, name, description")
        .eq("org_id", org.id),
      supabase
        .from("facility_group_members")
        .select("group_id, bay_id")
        .in("bay_id", bays.map((b) => b.id)),
      supabase
        .from("dynamic_schedule_rules")
        .select("*")
        .eq("org_id", org.id),
    ]);

    // Build facility groups with their bays
    const bayGroupMap = new Map<string, string>();
    for (const m of (members || [])) {
      bayGroupMap.set(m.bay_id, m.group_id);
    }

    const facilityGroups = (groups || [])
      .map((g) => ({
        ...g,
        bays: bays.filter((b) => bayGroupMap.get(b.id) === g.id),
      }))
      .filter((g) => g.bays.length > 0);

    const standaloneBays = bays.filter((b) => !bayGroupMap.has(b.id));

    // Get default durations from first rule
    let defaultDurations = [60];
    if (rules?.[0]?.available_durations) {
      defaultDurations = rules[0].available_durations;
    }

    // Fetch payment mode for demo org (use service client to bypass RLS)
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

    return {
      orgId: org.id,
      orgName: org.name,
      timezone: org.timezone,
      todayStr: getTodayInTimezone(org.timezone),
      bays,
      baysWithRates: baysWithRates || [],
      facilityGroups,
      standaloneBays,
      defaultDurations,
      existingRules: rules || [],
      bookableWindowDays: org.bookable_window_days ?? 30,
      minBookingLeadMinutes: org.min_booking_lead_minutes ?? 15,
      paymentMode,
    };
  } catch {
    return null;
  }
}

export default async function FacilityHomePage({
  searchParams: searchParamsPromise,
}: {
  searchParams?: Promise<{ [key: string]: string | undefined }>;
}) {
  const slug = await getFacilitySlug();
  const auth = await getAuthUser();

  if (!slug) {
    // No facility context — show marketing homepage
    const authInfo = auth
      ? { role: auth.profile.role, orgId: auth.profile.org_id }
      : null;

    // Fetch demo org data for interactive demos on marketing page
    const demoData = await fetchDemoOrgData();

    return <MarketingHomepage authInfo={authInfo} demoData={demoData} />;
  }

  const searchParams = searchParamsPromise ? await searchParamsPromise : {};

  // Fetch org details for the facility landing page
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, min_booking_lead_minutes, scheduling_type, bookable_window_days, locations_enabled")
    .eq("slug", slug)
    .single();

  const orgName = org?.name ?? slug.replace(/-/g, " ");
  const timezone = org?.timezone ?? "America/New_York";
  const minBookingLeadMinutes = org?.min_booking_lead_minutes ?? 15;
  const schedulingType = org?.scheduling_type ?? "slot_based";
  const bookableWindowDays = org?.bookable_window_days ?? 30;
  const locationsEnabled = org?.locations_enabled ?? false;

  // Resolve location context
  const activeLocationId = org
    ? await resolveLocationId(org.id, searchParams.location, auth?.user.id)
    : null;
  const locations = org && locationsEnabled
    ? await getOrgLocations(org.id)
    : [];

  // Check if user's preferred location was deactivated
  const showLocationDeactivatedBanner =
    org && locationsEnabled && auth
      ? await isPreferredLocationDeactivated(org.id, auth.user.id)
      : false;

  // Fetch active bays for the desktop availability widget (filtered by location)
  let baysQuery = org
    ? supabase
        .from("bays")
        .select("id, name, resource_type")
        .eq("org_id", org.id)
        .eq("is_active", true)
    : null;

  if (baysQuery && activeLocationId) {
    baysQuery = baysQuery.eq("location_id", activeLocationId);
  }

  const { data: bays } = baysQuery
    ? await baysQuery.order("sort_order").order("created_at")
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

  // Fetch membership context for booking integration
  let membershipContext: {
    isMember: boolean;
    effectiveWindowDays: number;
    guestWindowDays: number;
    memberWindowDays: number;
    discountType: "flat" | "percent" | null;
    discountValue: number;
    eventDiscountType: "flat" | "percent" | null;
    eventDiscountValue: number;
    tierName: string | null;
    membershipEnabled: boolean;
  } = {
    isMember: false,
    effectiveWindowDays: bookableWindowDays,
    guestWindowDays: bookableWindowDays,
    memberWindowDays: bookableWindowDays,
    discountType: null,
    discountValue: 0,
    eventDiscountType: null,
    eventDiscountValue: 0,
    tierName: null,
    membershipEnabled: false,
  };

  if (org) {
    const serviceClient = createServiceClient();
    const { data: orgMembership } = await serviceClient
      .from("organizations")
      .select("membership_tiers_enabled, guest_booking_window_days, member_booking_window_days")
      .eq("id", org.id)
      .single();

    if (orgMembership?.membership_tiers_enabled) {
      const guestWindow = orgMembership.guest_booking_window_days ?? bookableWindowDays;
      const memberWindow = orgMembership.member_booking_window_days ?? bookableWindowDays;

      let isMember = false;
      let userTier: {
        name: string;
        discount_type: string;
        discount_value: number;
        event_discount_type: string | null;
        event_discount_value: number;
        bookable_window_days: number | null;
      } | null = null;

      if (auth) {
        const { data: membership } = await serviceClient
          .from("user_memberships")
          .select("status, current_period_end, expires_at, tier_id")
          .eq("org_id", org.id)
          .eq("user_id", auth.user.id)
          .single();

        if (membership) {
          const now = new Date();
          isMember = !!(
            (membership.status === "active" &&
              (!membership.current_period_end || new Date(membership.current_period_end) > now)) ||
            (membership.status === "admin_granted" &&
              (!membership.expires_at || new Date(membership.expires_at) > now)) ||
            (membership.status === "cancelled" &&
              membership.current_period_end &&
              new Date(membership.current_period_end) > now)
          );

          // Fetch the user's specific tier for discount info
          if (isMember && membership.tier_id) {
            const { data: tier } = await serviceClient
              .from("membership_tiers")
              .select("name, discount_type, discount_value, event_discount_type, event_discount_value, bookable_window_days")
              .eq("id", membership.tier_id)
              .single();
            userTier = tier;
          }
        }
      }

      // If not a member or no tier found, get the first tier for upsell display
      if (!userTier) {
        const { data: firstTier } = await serviceClient
          .from("membership_tiers")
          .select("name, discount_type, discount_value, event_discount_type, event_discount_value, bookable_window_days")
          .eq("org_id", org.id)
          .order("sort_order", { ascending: true })
          .limit(1)
          .single();
        userTier = firstTier;
      }

      const effectiveWindow = isMember
        ? (userTier?.bookable_window_days ?? memberWindow)
        : guestWindow;

      membershipContext = {
        isMember,
        effectiveWindowDays: effectiveWindow,
        guestWindowDays: guestWindow,
        memberWindowDays: userTier?.bookable_window_days ?? memberWindow,
        discountType: userTier ? (userTier.discount_type as "flat" | "percent") : null,
        discountValue: userTier ? Number(userTier.discount_value) : 0,
        eventDiscountType: userTier ? (userTier.event_discount_type as "flat" | "percent" | null) : null,
        eventDiscountValue: userTier ? Number(userTier.event_discount_value ?? 0) : 0,
        tierName: userTier?.name ?? null,
        membershipEnabled: true,
      };
    }
  }

  // Fetch credit balance for active members
  let creditBalanceData: {
    has_credits: boolean;
    credits_total: number;
    credits_used: number;
    credits_remaining: number;
    credit_type: "hours" | "value" | null;
    credit_period: string | null;
    period_end: string | null;
  } | null = null;

  if (org && auth && membershipContext.isMember) {
    const serviceClient = createServiceClient();
    try {
      const { data } = await serviceClient.rpc("get_or_create_credit_balance", {
        p_org_id: org.id,
        p_user_id: auth.user.id,
      });
      if (data?.has_credits) {
        creditBalanceData = data;
      }
    } catch {
      // Non-fatal — credits just won't show
    }
  }

  // Fetch facility groups + members for dynamic scheduling
  let facilityGroups: Array<{
    id: string;
    name: string;
    description: string | null;
    bays: Array<{ id: string; name: string; resource_type: string | null }>;
  }> = [];
  let standaloneBays: Array<{ id: string; name: string; resource_type: string | null }> = [];
  let defaultDurations: number[] = [60];

  if (org && schedulingType === "dynamic" && bays && bays.length > 0) {
    let groupsQuery = supabase
      .from("facility_groups")
      .select("id, name, description")
      .eq("org_id", org.id);

    if (activeLocationId) {
      groupsQuery = groupsQuery.eq("location_id", activeLocationId);
    }

    let rulesQuery = supabase
      .from("dynamic_schedule_rules")
      .select("available_durations")
      .eq("org_id", org.id)
      .limit(1);

    if (activeLocationId) {
      rulesQuery = rulesQuery.eq("location_id", activeLocationId);
    }

    const [groupsResult, membersResult, rulesResult] = await Promise.all([
      groupsQuery,
      supabase
        .from("facility_group_members")
        .select("group_id, bay_id")
        .in("bay_id", bays.map((b) => b.id)),
      rulesQuery,
    ]);

    const groups = groupsResult.data || [];
    const members = membersResult.data || [];

    // Map bays to their groups
    const bayGroupMap = new Map<string, string>();
    for (const m of members) {
      bayGroupMap.set(m.bay_id, m.group_id);
    }

    // Build facility groups with their bays
    facilityGroups = groups.map((g) => ({
      ...g,
      bays: bays.filter((b) => bayGroupMap.get(b.id) === g.id),
    })).filter((g) => g.bays.length > 0);

    // Standalone bays = not in any group
    standaloneBays = bays.filter((b) => !bayGroupMap.has(b.id));

    // Get default durations from first rule
    if (rulesResult.data?.[0]?.available_durations) {
      defaultDurations = rulesResult.data[0].available_durations;
    }
  }

  const isDynamic = schedulingType === "dynamic";
  const isEventsOnly = schedulingType === "events_only";


  return (
    <div className="flex flex-1 flex-col">
      {/* =========== DESKTOP LAYOUT =========== */}
      <div className="hidden lg:flex lg:flex-1 lg:flex-col">
        {/* Deactivated location banner */}
        {showLocationDeactivatedBanner && (
          <div className="border-b bg-amber-50 dark:bg-amber-900/20">
            <div className="mx-auto max-w-6xl px-6 py-3">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Your default location has been deactivated.{" "}
                <Link href="/account" className="font-medium underline">
                  Choose a new default location
                </Link>
              </p>
            </div>
          </div>
        )}

        {/* Availability Widget / Events Feed */}
        <div className="flex-1 py-6">
          <div className="mx-auto max-w-6xl px-6">
            {org && isEventsOnly ? (
              <DynamicAvailabilityWidget
                orgId={org.id}
                orgName={orgName}
                timezone={timezone}
                bays={bays || []}
                facilityGroups={[]}
                standaloneBays={[]}
                defaultDurations={[60]}
                todayStr={todayStr}
                minBookingLeadMinutes={minBookingLeadMinutes}
                bookableWindowDays={membershipContext.effectiveWindowDays}
                facilitySlug={slug}
                isAuthenticated={!!auth}
                userEmail={auth?.profile.email}
                userFullName={auth?.profile.full_name}
                userProfileId={auth?.profile.id}
                paymentMode={paymentMode}
                cancellationWindowHours={cancellationWindowHours}
                locationId={activeLocationId}
                locations={locations}
                locationsEnabled={locationsEnabled}
                membership={membershipContext}
                creditBalance={creditBalanceData}
                eventsOnly
              />
            ) : org && bays && bays.length > 0 ? (
              isDynamic ? (
                <DynamicAvailabilityWidget
                  orgId={org.id}
                  orgName={orgName}
                  timezone={timezone}
                  bays={bays}
                  facilityGroups={facilityGroups}
                  standaloneBays={standaloneBays}
                  defaultDurations={defaultDurations}
                  todayStr={todayStr}
                  minBookingLeadMinutes={minBookingLeadMinutes}
                  bookableWindowDays={membershipContext.effectiveWindowDays}
                  facilitySlug={slug}
                  isAuthenticated={!!auth}
                  userEmail={auth?.profile.email}
                  userFullName={auth?.profile.full_name}
                  userProfileId={auth?.profile.id}
                  paymentMode={paymentMode}
                  cancellationWindowHours={cancellationWindowHours}
                  locationId={activeLocationId}
                  locations={locations}
                  locationsEnabled={locationsEnabled}
                  membership={membershipContext}
                creditBalance={creditBalanceData}
                />
              ) : (
                <AvailabilityWidget
                  orgId={org.id}
                  orgName={orgName}
                  timezone={timezone}
                  bays={bays}
                  todayStr={todayStr}
                  minBookingLeadMinutes={minBookingLeadMinutes}
                  bookableWindowDays={membershipContext.effectiveWindowDays}
                  facilitySlug={slug}
                  isAuthenticated={!!auth}
                  userEmail={auth?.profile.email}
                  userFullName={auth?.profile.full_name}
                  userProfileId={auth?.profile.id}
                  paymentMode={paymentMode}
                  cancellationWindowHours={cancellationWindowHours}
                  locationId={activeLocationId}
                  locations={locations}
                  locationsEnabled={locationsEnabled}
                  membership={membershipContext}
                creditBalance={creditBalanceData}
                />
              )
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
      <div className="flex flex-1 flex-col lg:hidden">
        <div className="flex flex-1 flex-col p-6">

          {/* Mobile availability widget / events feed */}
          {org && isEventsOnly ? (
            <DynamicAvailabilityWidget
              orgId={org.id}
              orgName={orgName}
              timezone={timezone}
              bays={bays || []}
              facilityGroups={[]}
              standaloneBays={[]}
              defaultDurations={[60]}
              todayStr={todayStr}
              minBookingLeadMinutes={minBookingLeadMinutes}
              bookableWindowDays={membershipContext.effectiveWindowDays}
              facilitySlug={slug}
              isAuthenticated={!!auth}
              paymentMode={paymentMode}
              cancellationWindowHours={cancellationWindowHours}
              locationId={activeLocationId}
              locations={locations}
              locationsEnabled={locationsEnabled}
              membership={membershipContext}
                creditBalance={creditBalanceData}
              eventsOnly
            />
          ) : org && bays && bays.length > 0 ? (
            isDynamic ? (
              <DynamicAvailabilityWidget
                orgId={org.id}
                orgName={orgName}
                timezone={timezone}
                bays={bays}
                facilityGroups={facilityGroups}
                standaloneBays={standaloneBays}
                defaultDurations={defaultDurations}
                todayStr={todayStr}
                minBookingLeadMinutes={minBookingLeadMinutes}
                bookableWindowDays={membershipContext.effectiveWindowDays}
                facilitySlug={slug}
                isAuthenticated={!!auth}
                userEmail={auth?.profile.email}
                userFullName={auth?.profile.full_name}
                userProfileId={auth?.profile.id}
                paymentMode={paymentMode}
                cancellationWindowHours={cancellationWindowHours}
                locationId={activeLocationId}
                locations={locations}
                locationsEnabled={locationsEnabled}
                membership={membershipContext}
                creditBalance={creditBalanceData}
              />
            ) : (
              <AvailabilityWidget
                orgId={org.id}
                orgName={orgName}
                timezone={timezone}
                bays={bays}
                todayStr={todayStr}
                minBookingLeadMinutes={minBookingLeadMinutes}
                bookableWindowDays={membershipContext.effectiveWindowDays}
                facilitySlug={slug}
                isAuthenticated={!!auth}
                userEmail={auth?.profile.email}
                userFullName={auth?.profile.full_name}
                userProfileId={auth?.profile.id}
                paymentMode={paymentMode}
                cancellationWindowHours={cancellationWindowHours}
                locationId={activeLocationId}
                locations={locations}
                locationsEnabled={locationsEnabled}
                membership={membershipContext}
                creditBalance={creditBalanceData}
              />
            )
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
