import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BrandingSettings } from "./branding-settings";
import { PaymentSettings } from "./payment-settings";
import { EmailSettingsToggles } from "@/components/admin/email-settings-toggles";
import {
  Settings,
  Building2,
  Clock,
  Globe,
  CheckCircle2,
  Mail,
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

export default async function FacilitySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  async function updateSettings(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();

    const name = formData.get("name") as string;
    const description = (formData.get("description") as string) || null;
    const address = (formData.get("address") as string) || null;
    const phone = (formData.get("phone") as string) || null;
    const timezone = formData.get("timezone") as string;
    const defaultDuration =
      parseInt(formData.get("default_slot_duration_minutes") as string) || 60;
    const minBookingLeadMinutes =
      parseInt(formData.get("min_booking_lead_minutes") as string) ?? 15;

    const { error } = await supabase
      .from("organizations")
      .update({
        name,
        description,
        address,
        phone,
        timezone,
        default_slot_duration_minutes: defaultDuration,
        min_booking_lead_minutes: minBookingLeadMinutes,
      })
      .eq("id", org.id);

    if (error) {
      redirect(
        `/admin/settings?error=${encodeURIComponent(error.message)}`
      );
    }
    revalidatePath("/admin/settings");
    revalidatePath("/admin");
    redirect("/admin/settings?saved=true");
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Settings
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Edit facility name, description, and timezone.
        </p>
      </div>

      {/* Alerts */}
      {params.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {params.error}
        </div>
      )}
      {params.saved && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Settings saved.
        </div>
      )}

      {/* Branding Section */}
      <BrandingSettings
        orgId={org.id}
        logoUrl={org.logo_url}
        coverPhotoUrl={org.cover_photo_url}
      />

      {/* Facility Details */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <h2 className="font-semibold text-gray-800 dark:text-white/90">
              Facility Details
            </h2>
          </div>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            These details are shown to customers on your booking pages.
          </p>
        </div>
        <div className="p-6">
          <form action={updateSettings} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Facility Name
                </label>
                <input
                  name="name"
                  defaultValue={org.name}
                  required
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Phone
                </label>
                <input
                  name="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  defaultValue={org.phone || ""}
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Description
                </label>
                <input
                  name="description"
                  placeholder="A short description of your facility"
                  defaultValue={org.description || ""}
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Address
                </label>
                <input
                  name="address"
                  placeholder="123 Main St, City, State ZIP"
                  defaultValue={org.address || ""}
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                />
              </div>
            </div>

            {/* Timezone & Duration Section */}
            <div className="border-t border-gray-200 pt-6 dark:border-white/[0.05]">
              <div className="mb-4 flex items-center gap-2">
                <Globe className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
                  Timezone & Scheduling
                </h3>
              </div>
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
            </div>

            {/* Booking Settings Section */}
            <div className="border-t border-gray-200 pt-6 dark:border-white/[0.05]">
              <div className="mb-4 flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
                  Booking Settings
                </h3>
              </div>
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
              </div>
            </div>

            <div className="flex items-center gap-4 border-t border-gray-200 pt-6 dark:border-white/[0.05]">
              <button
                type="submit"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
              >
                Save Settings
              </button>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Slug: <span className="font-mono">{org.slug}</span>
              </p>
            </div>
          </form>
        </div>
      </div>

      {/* Payment Processing */}
      <PaymentSettingsSection orgId={org.id} />

      {/* Email Notifications */}
      <EmailNotificationsSection orgId={org.id} />
    </div>
  );
}

async function PaymentSettingsSection({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const { data: paymentSettings } = await supabase
    .from("org_payment_settings")
    .select(
      "stripe_account_id, stripe_onboarding_complete, payment_mode, cancellation_window_hours, no_show_fee_cents, no_show_fee_type, processing_fee_absorbed_by"
    )
    .eq("org_id", orgId)
    .single();

  const initialSettings = paymentSettings || {
    stripe_account_id: null,
    stripe_onboarding_complete: false,
    payment_mode: "none",
    cancellation_window_hours: 24,
    no_show_fee_cents: null,
    no_show_fee_type: "fixed",
    processing_fee_absorbed_by: "customer",
  };

  return <PaymentSettings initialSettings={initialSettings} />;
}

async function EmailNotificationsSection({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const { data: emailSettings } = await supabase
    .from("org_email_settings")
    .select("id, notification_type, email_to_customer, email_to_admin")
    .eq("org_id", orgId)
    .order("notification_type");

  if (!emailSettings || emailSettings.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          <h2 className="font-semibold text-gray-800 dark:text-white/90">
            Email Notifications
          </h2>
        </div>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
          Control which email notifications are sent to customers and admins.
          Sign-up confirmation emails are always sent by the auth system and
          cannot be disabled here.
        </p>
      </div>
      <div className="p-6">
        <EmailSettingsToggles settings={emailSettings} />
      </div>
    </div>
  );
}
