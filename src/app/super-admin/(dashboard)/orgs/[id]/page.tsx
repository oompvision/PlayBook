import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function OrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", id)
    .single();

  if (!org) notFound();

  // Get bays and admins for this org
  const [baysResult, adminsResult] = await Promise.all([
    supabase
      .from("bays")
      .select("*")
      .eq("org_id", id)
      .order("sort_order"),
    supabase
      .from("profiles")
      .select("*")
      .eq("org_id", id)
      .eq("role", "admin"),
  ]);

  const bays = baysResult.data || [];
  const admins = adminsResult.data || [];

  async function updateOrg(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const { error } = await supabase
      .from("organizations")
      .update({
        name: formData.get("name") as string,
        description: (formData.get("description") as string) || null,
        address: (formData.get("address") as string) || null,
        phone: (formData.get("phone") as string) || null,
        timezone: formData.get("timezone") as string,
        default_slot_duration_minutes:
          parseInt(formData.get("default_slot_duration_minutes") as string) ||
          60,
      })
      .eq("id", id);

    if (error) {
      redirect(
        `/super-admin/orgs/${id}?error=${encodeURIComponent(error.message)}`
      );
    }
    redirect(`/super-admin/orgs/${id}?saved=true`);
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{org.name}</h1>
          <p className="mt-1 text-muted-foreground">{org.slug}.playbook.com</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/admin/enter/${id}`}>
            <Button variant="outline">Enter as Admin</Button>
          </a>
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        {/* Edit form */}
        <div className="lg:col-span-2">
          <form action={updateOrg}>
            <Card>
              <CardHeader>
                <CardTitle>Facility Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" defaultValue={org.name} required />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="timezone">Timezone</Label>
                    <select
                      id="timezone"
                      name="timezone"
                      defaultValue={org.timezone}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="America/New_York">Eastern (ET)</option>
                      <option value="America/Chicago">Central (CT)</option>
                      <option value="America/Denver">Mountain (MT)</option>
                      <option value="America/Los_Angeles">Pacific (PT)</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="default_slot_duration_minutes">
                      Slot Duration (min)
                    </Label>
                    <Input
                      id="default_slot_duration_minutes"
                      name="default_slot_duration_minutes"
                      type="number"
                      defaultValue={org.default_slot_duration_minutes}
                      min={15}
                      max={240}
                      step={15}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <textarea
                    id="description"
                    name="description"
                    rows={3}
                    defaultValue={org.description || ""}
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Input
                    id="address"
                    name="address"
                    defaultValue={org.address || ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    name="phone"
                    defaultValue={org.phone || ""}
                  />
                </div>
                <Button type="submit">Save Changes</Button>
              </CardContent>
            </Card>
          </form>
        </div>

        {/* Sidebar info */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Facilities</CardTitle>
              <CardDescription>{bays.length} resources</CardDescription>
            </CardHeader>
            <CardContent>
              {bays.length === 0 ? (
                <p className="text-sm text-muted-foreground">No facilities yet</p>
              ) : (
                <ul className="space-y-2">
                  {bays.map((bay) => (
                    <li
                      key={bay.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span>{bay.name}</span>
                      <Badge variant={bay.is_active ? "default" : "secondary"}>
                        {bay.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Admins</CardTitle>
              <CardDescription>{admins.length} admin users</CardDescription>
            </CardHeader>
            <CardContent>
              {admins.length === 0 ? (
                <p className="text-sm text-muted-foreground">No admins yet</p>
              ) : (
                <ul className="space-y-2">
                  {admins.map((admin) => (
                    <li key={admin.id} className="text-sm">
                      <p className="font-medium">
                        {admin.full_name || "Unnamed"}
                      </p>
                      <p className="text-muted-foreground">{admin.email}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
