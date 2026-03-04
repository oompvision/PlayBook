import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSuperAdmin } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
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
import { Mail, X, MapPin, Plus } from "lucide-react";

export default async function OrgDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { id } = await params;
  const { saved, invited, error: queryError, location_added, location_error } = await searchParams;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", id)
    .single();

  if (!org) notFound();

  // Get bays, admins, invitations, and locations for this org
  const [baysResult, adminsResult, invitationsResult, locationsResult] = await Promise.all([
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
    supabase
      .from("admin_invitations")
      .select("*")
      .eq("org_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("locations")
      .select("*")
      .eq("org_id", id)
      .order("created_at"),
  ]);

  const bays = baysResult.data || [];
  const admins = adminsResult.data || [];
  const invitations = invitationsResult.data || [];
  const locations = locationsResult.data || [];

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

  async function inviteAdmin(formData: FormData) {
    "use server";
    const auth = await requireSuperAdmin();
    const supabase = await createClient();
    const email = (formData.get("email") as string).trim().toLowerCase();

    if (!email) {
      redirect(
        `/super-admin/orgs/${id}?error=${encodeURIComponent("Email is required")}`
      );
    }

    // Check if email already exists in profiles
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingProfile) {
      redirect(
        `/super-admin/orgs/${id}?error=${encodeURIComponent("An account with this email already exists")}`
      );
    }

    // Create invitation record
    const { error: inviteDbError } = await supabase
      .from("admin_invitations")
      .insert({
        org_id: id,
        email,
        invited_by: auth.profile.id,
      });

    if (inviteDbError) {
      const message =
        inviteDbError.code === "23505"
          ? "This email has already been invited to this organization"
          : inviteDbError.message;
      redirect(
        `/super-admin/orgs/${id}?error=${encodeURIComponent(message)}`
      );
    }

    // Invite via Supabase Auth using service role client
    const serviceClient = createServiceClient();
    const headerStore = await headers();
    const host = headerStore.get("host") || "localhost:3000";
    const proto = headerStore.get("x-forwarded-proto") || "http";
    const siteUrl = `${proto}://${host}`;
    const { data: authData, error: authError } =
      await serviceClient.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${siteUrl}/auth/callback?next=/auth/admin-setup`,
        data: { role: "admin", org_id: id },
      });

    if (authError) {
      // Clean up invitation record on auth failure
      await supabase
        .from("admin_invitations")
        .delete()
        .eq("org_id", id)
        .eq("email", email);

      redirect(
        `/super-admin/orgs/${id}?error=${encodeURIComponent(authError.message)}`
      );
    }

    // Update the new user's profile to admin role for this org
    // Safety check: don't overwrite if they already belong to a different org
    if (authData?.user) {
      const { data: newProfile } = await serviceClient
        .from("profiles")
        .select("id, org_id, role")
        .eq("id", authData.user.id)
        .single();

      if (newProfile?.org_id && newProfile.org_id !== id) {
        // User already belongs to a different org — abort
        await supabase
          .from("admin_invitations")
          .delete()
          .eq("org_id", id)
          .eq("email", email);

        redirect(
          `/super-admin/orgs/${id}?error=${encodeURIComponent(
            "This user already belongs to another organization and cannot be reassigned."
          )}`
        );
      }

      await serviceClient
        .from("profiles")
        .update({ role: "admin", org_id: id })
        .eq("id", authData.user.id);
    }

    redirect(`/super-admin/orgs/${id}?invited=true`);
  }

  async function revokeInvite(formData: FormData) {
    "use server";
    await requireSuperAdmin();
    const supabase = await createClient();
    const invitationId = formData.get("invitation_id") as string;

    await supabase
      .from("admin_invitations")
      .update({ status: "revoked" })
      .eq("id", invitationId)
      .eq("org_id", id);

    redirect(`/super-admin/orgs/${id}`);
  }

  async function addLocation(formData: FormData) {
    "use server";
    await requireSuperAdmin();
    const supabase = await createClient();
    const name = (formData.get("location_name") as string)?.trim();
    const address = (formData.get("location_address") as string)?.trim() || null;

    if (!name) {
      redirect(`/super-admin/orgs/${id}?location_error=${encodeURIComponent("Location name is required")}`);
    }

    const { error } = await supabase
      .from("locations")
      .insert({ org_id: id, name, address });

    if (error) {
      redirect(`/super-admin/orgs/${id}?location_error=${encodeURIComponent(error.message)}`);
    }

    // locations_enabled is auto-updated by the DB trigger
    redirect(`/super-admin/orgs/${id}?location_added=true`);
  }

  async function toggleLocation(formData: FormData) {
    "use server";
    await requireSuperAdmin();
    const supabase = await createClient();
    const locationId = formData.get("location_id") as string;
    const newActive = formData.get("new_active") === "true";

    await supabase
      .from("locations")
      .update({ is_active: newActive })
      .eq("id", locationId)
      .eq("org_id", id);

    // locations_enabled is auto-updated by the DB trigger
    redirect(`/super-admin/orgs/${id}`);
  }

  async function deleteLocation(formData: FormData) {
    "use server";
    await requireSuperAdmin();
    const supabase = await createClient();
    const locationId = formData.get("location_id") as string;

    // Check for existing bookings
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("location_id", locationId);

    if (count && count > 0) {
      redirect(`/super-admin/orgs/${id}?location_error=${encodeURIComponent("Cannot delete a location that has existing bookings. Deactivate it instead.")}`);
    }

    const { error } = await supabase
      .from("locations")
      .delete()
      .eq("id", locationId)
      .eq("org_id", id);

    if (error) {
      redirect(`/super-admin/orgs/${id}?location_error=${encodeURIComponent(error.message)}`);
    }

    redirect(`/super-admin/orgs/${id}`);
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{org.name}</h1>
          <p className="mt-1 text-muted-foreground">{org.slug}.ezbooker.app</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/admin/enter/${id}`}>
            <Button variant="outline">Enter as Admin</Button>
          </a>
        </div>
      </div>

      {/* Banners */}
      {saved && (
        <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          Organization updated successfully.
        </div>
      )}
      {invited && (
        <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          Invitation sent successfully. The admin will receive an email with setup instructions.
        </div>
      )}
      {location_added && (
        <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          Location added successfully.
        </div>
      )}
      {(queryError || location_error) && (
        <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {queryError || location_error}
        </div>
      )}

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
            <CardContent className="space-y-4">
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

              {/* Invite form */}
              <form action={inviteAdmin} className="border-t pt-4">
                <Label htmlFor="invite-email" className="text-sm font-medium">
                  Invite Admin
                </Label>
                <div className="mt-2 flex gap-2">
                  <Input
                    id="invite-email"
                    name="email"
                    type="email"
                    placeholder="admin@example.com"
                    required
                    className="text-sm"
                  />
                  <Button type="submit" size="sm" className="shrink-0">
                    <Mail className="mr-1.5 h-3.5 w-3.5" />
                    Invite
                  </Button>
                </div>
              </form>

              {/* Pending/revoked invitations */}
              {invitations.length > 0 && (
                <div className="border-t pt-4">
                  <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Invitations
                  </p>
                  <ul className="space-y-2">
                    {invitations.map((inv) => (
                      <li
                        key={inv.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-muted-foreground">
                            {inv.email}
                          </p>
                        </div>
                        <div className="ml-2 flex items-center gap-1.5">
                          <Badge
                            variant={
                              inv.status === "accepted"
                                ? "default"
                                : inv.status === "pending"
                                  ? "outline"
                                  : "secondary"
                            }
                          >
                            {inv.status}
                          </Badge>
                          {inv.status === "pending" && (
                            <form action={revokeInvite}>
                              <input
                                type="hidden"
                                name="invitation_id"
                                value={inv.id}
                              />
                              <button
                                type="submit"
                                className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                                title="Revoke invitation"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </form>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Locations</CardTitle>
              <CardDescription>
                {locations.length} location{locations.length !== 1 ? "s" : ""}
                {org.locations_enabled && (
                  <Badge variant="outline" className="ml-2 text-xs">Multi-location</Badge>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {locations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No locations yet</p>
              ) : (
                <ul className="space-y-3">
                  {locations.map((loc) => (
                    <li key={loc.id} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">{loc.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          {loc.is_default && (
                            <Badge variant="outline" className="text-xs">Default</Badge>
                          )}
                          <Badge variant={loc.is_active ? "default" : "secondary"}>
                            {loc.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </div>
                      {loc.address && (
                        <p className="text-xs text-muted-foreground pl-5">{loc.address}</p>
                      )}
                      {!loc.is_default && (
                        <div className="flex gap-1.5 pl-5">
                          <form action={toggleLocation}>
                            <input type="hidden" name="location_id" value={loc.id} />
                            <input type="hidden" name="new_active" value={String(!loc.is_active)} />
                            <button
                              type="submit"
                              className="text-xs text-muted-foreground hover:text-foreground underline"
                            >
                              {loc.is_active ? "Deactivate" : "Activate"}
                            </button>
                          </form>
                          {!loc.is_active && (
                            <form action={deleteLocation}>
                              <input type="hidden" name="location_id" value={loc.id} />
                              <button
                                type="submit"
                                className="text-xs text-destructive hover:text-destructive/80 underline"
                              >
                                Delete
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* Add location form */}
              <form action={addLocation} className="border-t pt-4">
                <Label htmlFor="location_name" className="text-sm font-medium">
                  Add Location
                </Label>
                <div className="mt-2 space-y-2">
                  <Input
                    id="location_name"
                    name="location_name"
                    placeholder="Location name"
                    required
                    className="text-sm"
                  />
                  <Input
                    name="location_address"
                    placeholder="Address (optional)"
                    className="text-sm"
                  />
                  <Button type="submit" size="sm" className="w-full">
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add Location
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
