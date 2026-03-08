import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSuperAdmin } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
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
import {
  Mail,
  X,
  MapPin,
  Plus,
  CreditCard,
  Calendar,
  Users,
  Trash2,
} from "lucide-react";
import { EnterAsAdminButton } from "@/components/super-admin/enter-as-admin-button";
import { LocationCard } from "@/components/super-admin/location-card";

export default async function OrgDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { id } = await params;
  const {
    saved,
    invited,
    error: queryError,
    location_added,
    location_error,
  } = await searchParams;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", id)
    .single();

  if (!org) notFound();

  // Fetch all related data in parallel
  const [
    baysResult,
    adminsResult,
    invitationsResult,
    locationsResult,
    paymentResult,
    customerCountResult,
  ] = await Promise.all([
    supabase
      .from("bays")
      .select("id, name, is_active, location_id")
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
      .order("is_default", { ascending: false })
      .order("name"),
    supabase
      .from("org_payment_settings")
      .select("payment_mode, stripe_account_id, stripe_onboarding_complete")
      .eq("org_id", id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("org_id", id)
      .eq("role", "customer"),
  ]);

  const bays = baysResult.data || [];
  const admins = adminsResult.data || [];
  const invitations = invitationsResult.data || [];
  const locations = locationsResult.data || [];
  const paymentSettings = paymentResult.data;
  const customerCount = customerCountResult.count ?? 0;

  // Group bays by location_id
  const baysByLocation: Record<string, typeof bays> = {};
  for (const bay of bays) {
    const locId = bay.location_id || "_none";
    if (!baysByLocation[locId]) baysByLocation[locId] = [];
    baysByLocation[locId].push(bay);
  }

  // Derive payment status
  const stripeConnected =
    !!paymentSettings?.stripe_account_id &&
    !!paymentSettings?.stripe_onboarding_complete;
  const paymentMode = paymentSettings?.payment_mode ?? "none";

  // Scheduling type label
  const schedulingTypeLabel =
    org.scheduling_type === "dynamic" ? "Dynamic" : "Slot-based";

  // ── Server Actions ──

  async function updateOrgName(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const { error } = await supabase
      .from("organizations")
      .update({ name: formData.get("name") as string })
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
      await supabase
        .from("admin_invitations")
        .delete()
        .eq("org_id", id)
        .eq("email", email);

      redirect(
        `/super-admin/orgs/${id}?error=${encodeURIComponent(authError.message)}`
      );
    }

    if (authData?.user) {
      const { data: newProfile } = await serviceClient
        .from("profiles")
        .select("id, org_id, role")
        .eq("id", authData.user.id)
        .single();

      if (newProfile?.org_id && newProfile.org_id !== id) {
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
    const address =
      (formData.get("location_address") as string)?.trim() || null;

    if (!name) {
      redirect(
        `/super-admin/orgs/${id}?location_error=${encodeURIComponent("Location name is required")}`
      );
    }

    const { error } = await supabase
      .from("locations")
      .insert({ org_id: id, name, address });

    if (error) {
      redirect(
        `/super-admin/orgs/${id}?location_error=${encodeURIComponent(error.message)}`
      );
    }

    redirect(`/super-admin/orgs/${id}?location_added=true`);
  }

  async function toggleLocation(formData: FormData) {
    "use server";
    await requireSuperAdmin();
    const supabase = await createClient();
    const locationId = formData.get("location_id") as string;
    const newActive = formData.get("new_active") === "true";

    // If deactivating, check for active bookings
    if (!newActive) {
      const { count } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("location_id", locationId)
        .eq("status", "confirmed");

      if (count && count > 0) {
        redirect(
          `/super-admin/orgs/${id}?location_error=${encodeURIComponent(`Cannot deactivate: this location has ${count} active booking(s). Cancel them first.`)}`
        );
      }
    }

    await supabase
      .from("locations")
      .update({ is_active: newActive })
      .eq("id", locationId)
      .eq("org_id", id);

    redirect(`/super-admin/orgs/${id}`);
  }

  async function deleteLocation(formData: FormData) {
    "use server";
    await requireSuperAdmin();
    const supabase = await createClient();
    const locationId = formData.get("location_id") as string;

    // Check for any bookings (active or historical)
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("location_id", locationId)
      .eq("status", "confirmed");

    if (count && count > 0) {
      redirect(
        `/super-admin/orgs/${id}?location_error=${encodeURIComponent("Cannot delete a location that has active bookings. Deactivate it instead.")}`
      );
    }

    const { error } = await supabase
      .from("locations")
      .delete()
      .eq("id", locationId)
      .eq("org_id", id);

    if (error) {
      redirect(
        `/super-admin/orgs/${id}?location_error=${encodeURIComponent(error.message)}`
      );
    }

    redirect(`/super-admin/orgs/${id}`);
  }

  async function updateLocation(formData: FormData) {
    "use server";
    await requireSuperAdmin();
    const supabase = await createClient();
    const locationId = formData.get("location_id") as string;
    const name = (formData.get("location_name") as string)?.trim();
    const address =
      (formData.get("location_address") as string)?.trim() || null;

    if (!name) {
      redirect(
        `/super-admin/orgs/${id}?location_error=${encodeURIComponent("Location name is required")}`
      );
    }

    const { error } = await supabase
      .from("locations")
      .update({ name, address })
      .eq("id", locationId)
      .eq("org_id", id);

    if (error) {
      redirect(
        `/super-admin/orgs/${id}?location_error=${encodeURIComponent(error.message)}`
      );
    }

    redirect(`/super-admin/orgs/${id}?saved=true`);
  }

  return (
    <div className="max-w-3xl space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{org.name}</h1>
          <p className="mt-1 text-muted-foreground">{org.slug}.ezbooker.app</p>
        </div>
        <EnterAsAdminButton orgId={id} />
      </div>

      {/* Banners */}
      {saved && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          Organization updated successfully.
        </div>
      )}
      {invited && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          Invitation sent successfully. The admin will receive an email with
          setup instructions.
        </div>
      )}
      {location_added && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          Location added successfully.
        </div>
      )}
      {(queryError || location_error) && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {queryError || location_error}
        </div>
      )}

      {/* ─── Organization Info ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Organization Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Editable name */}
          <form action={updateOrgName} className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="name" className="text-xs font-medium text-muted-foreground">
                Organization Name
              </Label>
              <Input id="name" name="name" defaultValue={org.name} required />
            </div>
            <Button type="submit" size="sm">
              Save
            </Button>
          </form>

          {/* Read-only summary rows */}
          <div className="space-y-3 border-t pt-4">
            {/* Locations summary */}
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  Locations
                  {org.locations_enabled && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      Multi-location
                    </Badge>
                  )}
                </p>
                {locations.length === 0 ? (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    No locations
                  </p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {locations.map((loc) => (
                      <li
                        key={loc.id}
                        className="flex items-center gap-1.5 text-sm text-muted-foreground"
                      >
                        <span className="truncate">{loc.name}</span>
                        {loc.is_default && (
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px] px-1.5 py-0"
                          >
                            Default
                          </Badge>
                        )}
                        <Badge
                          variant={loc.is_active ? "default" : "secondary"}
                          className="shrink-0 text-[10px] px-1.5 py-0"
                        >
                          {loc.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Payment setup */}
            <div className="flex items-center gap-3">
              <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Payment</p>
                <p className="text-sm text-muted-foreground">
                  {stripeConnected ? (
                    <>
                      Stripe connected
                      <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0">
                        {paymentMode === "charge_upfront"
                          ? "Charge Upfront"
                          : paymentMode === "hold"
                            ? "Hold"
                            : paymentMode === "hold_charge_manual"
                              ? "Hold + Manual Charge"
                              : "None"}
                      </Badge>
                    </>
                  ) : (
                    "Stripe not connected"
                  )}
                </p>
              </div>
            </div>

            {/* Scheduling type */}
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Scheduling</p>
                <p className="text-sm text-muted-foreground">
                  {schedulingTypeLabel}
                </p>
              </div>
            </div>

            {/* Customer count */}
            <div className="flex items-center gap-3">
              <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Customers</p>
                <p className="text-sm text-muted-foreground">
                  {customerCount} registered
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Admins ─── */}
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
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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

      {/* ─── Locations Header + Add Button ─── */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">Locations</h2>
      </div>

      {/* Add Location Form (collapsible inline) */}
      <Card>
        <CardContent className="pt-6">
          <form action={addLocation} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px] space-y-1.5">
              <Label htmlFor="location_name" className="text-xs font-medium text-muted-foreground">
                Name
              </Label>
              <Input
                id="location_name"
                name="location_name"
                placeholder="e.g. Downtown Branch"
                required
                className="text-sm"
              />
            </div>
            <div className="flex-1 min-w-[180px] space-y-1.5">
              <Label htmlFor="location_address" className="text-xs font-medium text-muted-foreground">
                Address (optional)
              </Label>
              <Input
                id="location_address"
                name="location_address"
                placeholder="123 Main St"
                className="text-sm"
              />
            </div>
            <Button type="submit" size="sm" className="shrink-0">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Location
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ─── Per-Location Sections ─── */}
      {locations.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <MapPin className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">
              No locations yet. Add one above.
            </p>
          </CardContent>
        </Card>
      ) : (
        locations.map((loc) => {
          const locationBays = baysByLocation[loc.id] || [];
          return (
            <LocationCard
              key={loc.id}
              location={loc}
              bays={locationBays}
              orgId={id}
              toggleAction={toggleLocation}
              deleteAction={deleteLocation}
              updateAction={updateLocation}
            />
          );
        })
      )}
    </div>
  );
}
