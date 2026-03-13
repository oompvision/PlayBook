export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getFacilitySlug } from "@/lib/facility";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BrandingSettings } from "../branding-settings";
import { SettingsAccordion } from "@/components/admin/settings-accordion";
import { FormStickyFooter } from "@/components/admin/form-sticky-footer";
import {
  Building2,
  Palette,
} from "lucide-react";

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

export default async function BusinessDetailsPage({
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

    // Use service role client to bypass RLS — auth is already verified
    const service = createServiceClient();
    const { error } = await service
      .from("organizations")
      .update({ name, description, address, phone })
      .eq("id", org.id);

    if (error) {
      redirect(
        `/admin/settings/business-details?error=${encodeURIComponent(error.message)}`
      );
    }
    revalidatePath("/admin/settings/business-details");
    revalidatePath("/admin");
    redirect("/admin/settings/business-details?saved=true");
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Business Details
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage your facility name, contact info, and branding.
        </p>
      </div>

      {/* Alerts */}
      {params.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {params.error}
        </div>
      )}

      {/* Business Details */}
      <FormStickyFooter
        action={updateSettings}
        submitLabel="Save Details"
        toastMessage="Business details saved."
      >
        <SettingsAccordion
          icon={<Building2 className="h-[18px] w-[18px] text-gray-500 dark:text-gray-400" />}
          title="Business Details"
          description="These details are shown to customers on your booking pages."
          defaultOpen
        >
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
          <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
            Slug: <span className="font-mono">{org.slug}</span>
          </p>
        </SettingsAccordion>
      </FormStickyFooter>

      {/* Branding Section */}
      <SettingsAccordion
        icon={<Palette className="h-[18px] w-[18px] text-gray-500 dark:text-gray-400" />}
        title="Branding"
        description="Customize how your facility appears to customers."
      >
        <BrandingSettings
          orgId={org.id}
          logoUrl={org.logo_url}
          coverPhotoUrl={org.cover_photo_url}
        />
      </SettingsAccordion>
    </div>
  );
}
