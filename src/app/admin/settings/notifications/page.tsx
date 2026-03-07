export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { EmailSettingsToggles } from "@/components/admin/email-settings-toggles";
import { Mail } from "lucide-react";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function NotificationsSettingsPage() {
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const { data: emailSettings } = await supabase
    .from("org_email_settings")
    .select("id, notification_type, email_to_customer, email_to_admin")
    .eq("org_id", org.id)
    .order("notification_type");

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Notification Settings
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Control which email notifications are sent to customers and admins.
        </p>
      </div>

      {/* Email Notifications */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <h2 className="font-semibold text-gray-800 dark:text-white/90">
              Notification Settings
            </h2>
          </div>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Control which email notifications are sent to customers and admins.
            Sign-up confirmation emails are always sent by the auth system and
            cannot be disabled here.
          </p>
        </div>
        <div className="p-6">
          {emailSettings && emailSettings.length > 0 ? (
            <EmailSettingsToggles settings={emailSettings} />
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No notification settings configured yet. They will appear here
              once email notifications are set up for your organization.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
