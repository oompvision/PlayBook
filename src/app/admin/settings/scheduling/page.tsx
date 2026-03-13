export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getFacilitySlug } from "@/lib/facility";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SchedulingModeSettings } from "../scheduling-mode-settings";
import { EventsSettings } from "../events-settings";
import { SettingsAccordion } from "@/components/admin/settings-accordion";
import { FormStickyFooter } from "@/components/admin/form-sticky-footer";
import {
  Globe,
  Clock,
  CalendarCog,
  CalendarDays,
} from "lucide-react";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Phoenix",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Asia/Tokyo",
  "Asia/Dubai",
];

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function SchedulingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  async function updateSchedulingSettings(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();

    const timezone = formData.get("timezone") as string;
    const defaultDuration =
      parseInt(formData.get("default_slot_duration_minutes") as string) || 60;
    const minBookingLeadMinutes =
      parseInt(formData.get("min_booking_lead_minutes") as string) ?? 15;

    const updateData: Record<string, unknown> = {
      timezone,
      default_slot_duration_minutes: defaultDuration,
      min_booking_lead_minutes: minBookingLeadMinutes,
    };

    if (!org.membership_tiers_enabled) {
      const bookableWindowDays = Math.min(
        365,
        Math.max(1, parseInt(formData.get("bookable_window_days") as string) || 30)
      );
      updateData.bookable_window_days = bookableWindowDays;
    }

    // Use service role client to bypass RLS — auth is already verified
    const service = createServiceClient();
    const { error } = await service
      .from("organizations")
      .update(updateData)
      .eq("id", org.id);

    if (error) {
      redirect(
        `/admin/settings/scheduling?error=${encodeURIComponent(error.message)}`
      );
    }
    revalidatePath("/admin/settings/scheduling");
    revalidatePath("/admin");
    redirect("/admin/settings/scheduling?saved=true");
  }

  // Fetch events data
  const supabase = await createClient();

  const { data: publishedEvents } = await supabase
    .from("events")
    .select("id")
    .eq("org_id", org.id)
    .eq("status", "published")
    .gt("end_time", new Date().toISOString());

  let activeEventCount = 0;
  if (publishedEvents && publishedEvents.length > 0) {
    const eventIds = publishedEvents.map((e) => e.id);
    const { count } = await supabase
      .from("event_registrations")
      .select("id", { count: "exact", head: true })
      .in("event_id", eventIds)
      .in("status", ["confirmed", "pending_payment"]);
    if (count && count > 0) activeEventCount = publishedEvents.length;
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Scheduling Settings
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Configure scheduling mode, timezone, and booking rules.
        </p>
      </div>

      {/* Alerts */}
      {params.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {params.error}
        </div>
      )}

      {/* Scheduling Mode */}
      <SettingsAccordion
        icon={<CalendarCog className="h-[18px] w-[18px] text-gray-500 dark:text-gray-400" />}
        title="Scheduling Mode"
        description="Choose how customers book time at your facility."
        defaultOpen
      >
        <SchedulingModeSettings
          initialMode={org.scheduling_type ?? "slot_based"}
          initialBookableWindowDays={org.bookable_window_days ?? 30}
        />
      </SettingsAccordion>

      {/* Timezone & Scheduling + Booking Settings share one form */}
      <FormStickyFooter
        action={updateSchedulingSettings}
        className="space-y-6"
        submitLabel="Save Settings"
        toastMessage="Scheduling settings saved."
      >
        <SettingsAccordion
          icon={<Globe className="h-[18px] w-[18px] text-gray-500 dark:text-gray-400" />}
          title="Timezone & Scheduling"
          description="Set your facility timezone and default slot duration."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Timezone
              </label>
              <select
                name="timezone"
                defaultValue={org.timezone}
                className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                All schedule times are displayed in this timezone.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Default Slot Duration (minutes)
              </label>
              <input
                name="default_slot_duration_minutes"
                type="number"
                min="15"
                step="15"
                defaultValue={org.default_slot_duration_minutes}
                className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              />
            </div>
          </div>
        </SettingsAccordion>

        <SettingsAccordion
          icon={<Clock className="h-[18px] w-[18px] text-gray-500 dark:text-gray-400" />}
          title="Booking Settings"
          description="Configure minimum lead times and bookable windows."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Minimum Booking Lead Time (minutes)
              </label>
              <input
                name="min_booking_lead_minutes"
                type="number"
                min="0"
                step="5"
                defaultValue={org.min_booking_lead_minutes ?? 15}
                className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Time slots starting within this many minutes from now will
                not be shown to customers. Set to 0 to show all slots until
                their start time.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Bookable Window (days)
              </label>
              {org.membership_tiers_enabled ? (
                <div className="flex h-10 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-gray-400">
                  {org.guest_booking_window_days ?? org.bookable_window_days ?? 30} days (guest) / {org.member_booking_window_days ?? org.bookable_window_days ?? 30} days (member)
                </div>
              ) : (
                <input
                  name="bookable_window_days"
                  type="number"
                  min="1"
                  max="365"
                  defaultValue={org.bookable_window_days ?? 30}
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                />
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {org.membership_tiers_enabled
                  ? "Bookable Window is managed in the Membership Management settings."
                  : "How many days into the future customers can book. Admins can still build schedules beyond this window."}
              </p>
            </div>
          </div>
        </SettingsAccordion>
      </FormStickyFooter>

      {/* Events Toggle */}
      <SettingsAccordion
        icon={<CalendarDays className="h-[18px] w-[18px] text-gray-500 dark:text-gray-400" />}
        title="Events"
        description="Create and manage open-enrollment events — clinics, group sessions, and more."
      >
        <EventsSettings
          initialEnabled={org.events_enabled ?? true}
          activeEventCount={activeEventCount}
        />
      </SettingsAccordion>
    </div>
  );
}
