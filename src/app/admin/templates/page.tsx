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

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, default_slot_duration_minutes")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; error?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();

  const { data: templates } = await supabase
    .from("schedule_templates")
    .select("*, template_slots(*)")
    .eq("org_id", org.id)
    .order("created_at");

  async function createTemplate(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();

    const name = formData.get("name") as string;
    const description = (formData.get("description") as string) || null;

    const { data: template, error } = await supabase
      .from("schedule_templates")
      .insert({ org_id: org.id, name, description })
      .select("id")
      .single();

    if (error) {
      redirect(`/admin/templates?error=${encodeURIComponent(error.message)}`);
    }
    redirect(`/admin/templates?edit=${template.id}&saved=true`);
  }

  async function updateTemplate(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const description = (formData.get("description") as string) || null;

    const { error } = await supabase
      .from("schedule_templates")
      .update({ name, description })
      .eq("id", id);

    if (error) {
      redirect(
        `/admin/templates?edit=${id}&error=${encodeURIComponent(error.message)}`
      );
    }
    revalidatePath("/admin/templates");
    redirect(`/admin/templates?edit=${id}&saved=true`);
  }

  async function deleteTemplate(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const id = formData.get("id") as string;
    await supabase.from("schedule_templates").delete().eq("id", id);
    revalidatePath("/admin/templates");
    redirect("/admin/templates");
  }

  async function addSlot(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const templateId = formData.get("template_id") as string;
    const startTime = formData.get("start_time") as string;
    const endTime = formData.get("end_time") as string;
    const price = parseFloat(formData.get("price") as string) || 0;

    const { error } = await supabase.from("template_slots").insert({
      template_id: templateId,
      start_time: startTime,
      end_time: endTime,
      price_cents: Math.round(price * 100),
    });

    if (error) {
      redirect(
        `/admin/templates?edit=${templateId}&error=${encodeURIComponent(error.message)}`
      );
    }
    revalidatePath("/admin/templates");
    redirect(`/admin/templates?edit=${templateId}`);
  }

  async function removeSlot(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const slotId = formData.get("slot_id") as string;
    const templateId = formData.get("template_id") as string;
    await supabase.from("template_slots").delete().eq("id", slotId);
    revalidatePath("/admin/templates");
    redirect(`/admin/templates?edit=${templateId}`);
  }

  async function generateSlots(formData: FormData) {
    "use server";
    const org = await getOrg();
    if (!org) return;
    const supabase = await createClient();
    const templateId = formData.get("template_id") as string;
    const openTime = formData.get("open_time") as string;
    const closeTime = formData.get("close_time") as string;
    const durationMin =
      parseInt(formData.get("duration") as string) ||
      org.default_slot_duration_minutes;
    const price = parseFloat(formData.get("slot_price") as string) || 0;

    const slots: {
      template_id: string;
      start_time: string;
      end_time: string;
      price_cents: number;
    }[] = [];

    const [openH, openM] = openTime.split(":").map(Number);
    const [closeH, closeM] = closeTime.split(":").map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    for (
      let t = openMinutes;
      t + durationMin <= closeMinutes;
      t += durationMin
    ) {
      const sh = Math.floor(t / 60);
      const sm = t % 60;
      const eh = Math.floor((t + durationMin) / 60);
      const em = (t + durationMin) % 60;
      slots.push({
        template_id: templateId,
        start_time: `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`,
        end_time: `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`,
        price_cents: Math.round(price * 100),
      });
    }

    if (slots.length > 0) {
      await supabase
        .from("template_slots")
        .delete()
        .eq("template_id", templateId);

      const { error } = await supabase.from("template_slots").insert(slots);
      if (error) {
        redirect(
          `/admin/templates?edit=${templateId}&error=${encodeURIComponent(error.message)}`
        );
      }
    }

    revalidatePath("/admin/templates");
    redirect(`/admin/templates?edit=${templateId}&saved=true`);
  }

  const editingTemplate = params.edit
    ? templates?.find((t) => t.id === params.edit)
    : null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Templates</h1>
          <p className="mt-2 text-muted-foreground">
            Create reusable schedule templates with time slots.
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

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Template list */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Your Templates
          </h2>
          {(!templates || templates.length === 0) && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No templates yet.
            </p>
          )}
          {templates?.map((t) => (
            <a
              key={t.id}
              href={`/admin/templates?edit=${t.id}`}
              className={`block rounded-lg border p-3 transition-colors hover:bg-accent ${
                editingTemplate?.id === t.id
                  ? "border-primary bg-accent"
                  : ""
              }`}
            >
              <p className="font-medium">{t.name}</p>
              <p className="text-sm text-muted-foreground">
                {t.template_slots?.length || 0} slots
                {t.description ? ` · ${t.description}` : ""}
              </p>
            </a>
          ))}

          <Card className="mt-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">New Template</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createTemplate} className="space-y-3">
                <Input name="name" placeholder="e.g. Weekday Hours" required />
                <Input
                  name="description"
                  placeholder="Description (optional)"
                />
                <Button type="submit" size="sm" className="w-full">
                  Create Template
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Template editor */}
        <div className="lg:col-span-2">
          {!editingTemplate ? (
            <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Select a template to edit, or create a new one.
            </div>
          ) : (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{editingTemplate.name}</CardTitle>
                  <CardDescription>
                    Edit template details and manage time slots.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form action={updateTemplate} className="space-y-4">
                    <input
                      type="hidden"
                      name="id"
                      value={editingTemplate.id}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="edit-name">Name</Label>
                        <Input
                          id="edit-name"
                          name="name"
                          defaultValue={editingTemplate.name}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-desc">Description</Label>
                        <Input
                          id="edit-desc"
                          name="description"
                          defaultValue={editingTemplate.description || ""}
                        />
                      </div>
                    </div>
                    <Button type="submit" size="sm">
                      Save Details
                    </Button>
                  </form>
                  <form action={deleteTemplate} className="mt-2">
                    <input
                      type="hidden"
                      name="id"
                      value={editingTemplate.id}
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10"
                    >
                      Delete Template
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Quick generate */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Quick Generate Slots
                  </CardTitle>
                  <CardDescription>
                    Auto-generate evenly spaced slots. This replaces all
                    existing slots.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form action={generateSlots} className="space-y-4">
                    <input
                      type="hidden"
                      name="template_id"
                      value={editingTemplate.id}
                    />
                    <div className="grid gap-4 sm:grid-cols-4">
                      <div className="space-y-2">
                        <Label htmlFor="open_time">Open Time</Label>
                        <Input
                          id="open_time"
                          name="open_time"
                          type="time"
                          defaultValue="09:00"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="close_time">Close Time</Label>
                        <Input
                          id="close_time"
                          name="close_time"
                          type="time"
                          defaultValue="21:00"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="duration">Duration (min)</Label>
                        <Input
                          id="duration"
                          name="duration"
                          type="number"
                          min={15}
                          max={240}
                          step={15}
                          defaultValue={org.default_slot_duration_minutes}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="slot_price">Price ($)</Label>
                        <Input
                          id="slot_price"
                          name="slot_price"
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue="0"
                        />
                      </div>
                    </div>
                    <Button type="submit" size="sm">
                      Generate Slots
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Slot list */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Time Slots</CardTitle>
                  <CardDescription>
                    {editingTemplate.template_slots?.length || 0} slots defined
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {(!editingTemplate.template_slots ||
                    editingTemplate.template_slots.length === 0) && (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No slots yet. Use Quick Generate or add manually below.
                    </p>
                  )}

                  {editingTemplate.template_slots &&
                    editingTemplate.template_slots.length > 0 && (
                      <div className="space-y-2">
                        {[...editingTemplate.template_slots]
                          .sort((a, b) =>
                            a.start_time.localeCompare(b.start_time)
                          )
                          .map((slot) => (
                            <div
                              key={slot.id}
                              className="flex items-center justify-between rounded-md border px-3 py-2"
                            >
                              <div className="flex items-center gap-4">
                                <span className="font-mono text-sm">
                                  {slot.start_time.slice(0, 5)} –{" "}
                                  {slot.end_time.slice(0, 5)}
                                </span>
                                {slot.price_cents != null && (
                                  <span className="text-sm text-muted-foreground">
                                    ${(slot.price_cents / 100).toFixed(2)}
                                  </span>
                                )}
                              </div>
                              <form action={removeSlot}>
                                <input
                                  type="hidden"
                                  name="slot_id"
                                  value={slot.id}
                                />
                                <input
                                  type="hidden"
                                  name="template_id"
                                  value={editingTemplate.id}
                                />
                                <Button
                                  type="submit"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs text-destructive hover:bg-destructive/10"
                                >
                                  Remove
                                </Button>
                              </form>
                            </div>
                          ))}
                      </div>
                    )}

                  <form
                    action={addSlot}
                    className="mt-4 flex items-end gap-3 border-t pt-4"
                  >
                    <input
                      type="hidden"
                      name="template_id"
                      value={editingTemplate.id}
                    />
                    <div className="space-y-1">
                      <Label className="text-xs">Start</Label>
                      <Input
                        name="start_time"
                        type="time"
                        required
                        className="w-32"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">End</Label>
                      <Input
                        name="end_time"
                        type="time"
                        required
                        className="w-32"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Price ($)</Label>
                      <Input
                        name="price"
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue="0"
                        className="w-24"
                      />
                    </div>
                    <Button type="submit" size="sm">
                      Add Slot
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
