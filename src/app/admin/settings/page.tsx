import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

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

    const { error } = await supabase
      .from("organizations")
      .update({
        name,
        description,
        address,
        phone,
        timezone,
        default_slot_duration_minutes: defaultDuration,
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
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      <p className="mt-2 text-muted-foreground">
        Edit facility name, description, and timezone.
      </p>

      {params.error && (
        <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {params.error}
        </div>
      )}
      {params.saved && (
        <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          Settings saved.
        </div>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">Facility Details</CardTitle>
          <CardDescription>
            These details are shown to customers on your booking pages.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateSettings} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Facility Name</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={org.name}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  defaultValue={org.phone || ""}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  name="description"
                  placeholder="A short description of your facility"
                  defaultValue={org.description || ""}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  name="address"
                  placeholder="123 Main St, City, State ZIP"
                  defaultValue={org.address || ""}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <select
                  id="timezone"
                  name="timezone"
                  defaultValue={org.timezone}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  All schedule times are displayed in this timezone.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="duration">Default Slot Duration (minutes)</Label>
                <Input
                  id="duration"
                  name="default_slot_duration_minutes"
                  type="number"
                  min="15"
                  step="15"
                  defaultValue={org.default_slot_duration_minutes}
                />
              </div>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <Button type="submit">Save Settings</Button>
              <p className="text-xs text-muted-foreground">
                Slug: <span className="font-mono">{org.slug}</span>
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
