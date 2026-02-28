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
import { Mail, X } from "lucide-react";

export default async function OrgDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { id } = await params;
  const { saved, invited, error: queryError } = await searchParams;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", id)
    .single();

  if (!org) notFound();

  // Get bays, admins, and invitations for this org
  const [baysResult, adminsResult, invitationsResult] = await Promise.all([
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
  ]);

  const bays = baysResult.data || [];
  const admins = adminsResult.data || [];
  const invitations = invitationsResult.data || [];

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
    if (authData?.user) {
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
      {queryError && (
        <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {queryError}
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
        </div>
      </div>
    </div>
  );
}
