import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function BayManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; error?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();
  const { data: bays } = await supabase
    .from("bays")
    .select("*")
    .eq("org_id", org.id)
    .order("sort_order")
    .order("created_at");

  const editingId = params.edit;

  async function createBay(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();

    const name = formData.get("name") as string;
    const hourlyRate = parseFloat(formData.get("hourly_rate") as string) || 0;
    const resourceType = (formData.get("resource_type") as string) || null;
    const description = (formData.get("description") as string) || null;

    // Get max sort_order for this org
    const { data: maxBay } = await supabase
      .from("bays")
      .select("sort_order")
      .eq("org_id", org.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .single();

    const nextOrder = (maxBay?.sort_order ?? -1) + 1;

    const { error } = await supabase.from("bays").insert({
      org_id: org.id,
      name,
      hourly_rate_cents: Math.round(hourlyRate * 100),
      resource_type: resourceType,
      description,
      sort_order: nextOrder,
    });

    if (error) {
      redirect(`/admin/bays?error=${encodeURIComponent(error.message)}`);
    }
    revalidatePath("/admin/bays");
    redirect("/admin/bays?saved=true");
  }

  async function updateBay(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const hourlyRate = parseFloat(formData.get("hourly_rate") as string) || 0;
    const resourceType = (formData.get("resource_type") as string) || null;
    const description = (formData.get("description") as string) || null;

    const { error } = await supabase
      .from("bays")
      .update({
        name,
        hourly_rate_cents: Math.round(hourlyRate * 100),
        resource_type: resourceType,
        description,
      })
      .eq("id", id);

    if (error) {
      redirect(
        `/admin/bays?edit=${id}&error=${encodeURIComponent(error.message)}`
      );
    }
    revalidatePath("/admin/bays");
    redirect("/admin/bays?saved=true");
  }

  async function toggleBay(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    const newStatus = formData.get("is_active") === "true";

    await supabase.from("bays").update({ is_active: newStatus }).eq("id", id);
    revalidatePath("/admin/bays");
  }

  async function deleteBay(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    await supabase.from("bays").delete().eq("id", id);
    revalidatePath("/admin/bays");
    redirect("/admin/bays");
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bays</h1>
          <p className="mt-2 text-muted-foreground">
            Manage your bookable resources — simulator bays, courts, and more.
          </p>
        </div>
      </div>

      {params.error && (
        <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {params.error}
        </div>
      )}
      {params.saved && (
        <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          Changes saved successfully.
        </div>
      )}

      {/* Bay list */}
      <div className="mt-8 space-y-3">
        {(!bays || bays.length === 0) && !editingId && (
          <p className="py-8 text-center text-muted-foreground">
            No bays yet. Add your first one below.
          </p>
        )}

        {bays?.map((bay) =>
          editingId === bay.id ? (
            /* Edit form */
            <Card key={bay.id}>
              <CardHeader>
                <CardTitle className="text-base">Edit Bay</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={updateBay} className="space-y-4">
                  <input type="hidden" name="id" value={bay.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="edit-name">Name</Label>
                      <Input
                        id="edit-name"
                        name="name"
                        defaultValue={bay.name}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-rate">Hourly Rate ($)</Label>
                      <Input
                        id="edit-rate"
                        name="hourly_rate"
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={(bay.hourly_rate_cents / 100).toFixed(2)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-type">Resource Type</Label>
                      <Input
                        id="edit-type"
                        name="resource_type"
                        placeholder="e.g. Golf Simulator, Tennis Court"
                        defaultValue={bay.resource_type || ""}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-desc">Description</Label>
                      <Input
                        id="edit-desc"
                        name="description"
                        placeholder="Optional notes"
                        defaultValue={bay.description || ""}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">
                      Save
                    </Button>
                    <a href="/admin/bays">
                      <Button type="button" variant="outline" size="sm">
                        Cancel
                      </Button>
                    </a>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : (
            /* Bay row */
            <div
              key={bay.id}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{bay.name}</p>
                    <Badge
                      variant={bay.is_active ? "default" : "secondary"}
                    >
                      {bay.is_active ? "Active" : "Inactive"}
                    </Badge>
                    {bay.resource_type && (
                      <Badge variant="outline">{bay.resource_type}</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    ${(bay.hourly_rate_cents / 100).toFixed(2)}/hr
                    {bay.description ? ` · ${bay.description}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <form action={toggleBay}>
                  <input type="hidden" name="id" value={bay.id} />
                  <input
                    type="hidden"
                    name="is_active"
                    value={bay.is_active ? "false" : "true"}
                  />
                  <Button type="submit" variant="outline" size="sm">
                    {bay.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </form>
                <a href={`/admin/bays?edit=${bay.id}`}>
                  <Button variant="outline" size="sm">
                    Edit
                  </Button>
                </a>
                <form action={deleteBay}>
                  <input type="hidden" name="id" value={bay.id} />
                  <Button type="submit" variant="outline" size="sm" className="text-destructive hover:bg-destructive/10">
                    Delete
                  </Button>
                </form>
              </div>
            </div>
          )
        )}
      </div>

      {/* Add new bay form */}
      {!editingId && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="text-base">Add New Bay</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createBay} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-name">Name</Label>
                  <Input
                    id="new-name"
                    name="name"
                    placeholder="e.g. Bay 1, Court A"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-rate">Hourly Rate ($)</Label>
                  <Input
                    id="new-rate"
                    name="hourly_rate"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-type">Resource Type</Label>
                  <Input
                    id="new-type"
                    name="resource_type"
                    placeholder="e.g. Golf Simulator, Tennis Court"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-desc">Description</Label>
                  <Input
                    id="new-desc"
                    name="description"
                    placeholder="Optional notes"
                  />
                </div>
              </div>
              <Button type="submit">Add Bay</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
