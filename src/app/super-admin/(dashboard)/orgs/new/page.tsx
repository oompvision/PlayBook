import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CreateOrgForm } from "./form";

export default function CreateOrgPage() {
  async function createOrg(formData: FormData) {
    "use server";

    const supabase = await createClient();

    const name = formData.get("name") as string;
    const slug = (formData.get("slug") as string)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const timezone = (formData.get("timezone") as string) || "America/New_York";
    const defaultSlotDuration =
      parseInt(formData.get("default_slot_duration_minutes") as string) || 60;
    const description = formData.get("description") as string;
    const address = formData.get("address") as string;
    const phone = formData.get("phone") as string;

    const { data: org, error } = await supabase
      .from("organizations")
      .insert({
        name,
        slug,
        timezone,
        default_slot_duration_minutes: defaultSlotDuration,
        description: description || null,
        address: address || null,
        phone: phone || null,
      })
      .select()
      .single();

    if (error) {
      // Redirect back with error
      redirect(
        `/super-admin/orgs/new?error=${encodeURIComponent(error.message)}`
      );
    }

    // If admin email was provided, create the admin account
    const adminEmail = formData.get("admin_email") as string;
    const adminPassword = formData.get("admin_password") as string;
    const adminName = formData.get("admin_name") as string;

    if (adminEmail && adminPassword && org) {
      // Create admin user via Supabase Auth (using service role would be better, but this works for now)
      const { data: authData, error: authError } =
        await supabase.auth.admin.createUser({
          email: adminEmail,
          password: adminPassword,
          email_confirm: true,
          user_metadata: { full_name: adminName || "" },
        });

      if (!authError && authData.user) {
        // Update the profile to be an admin for this org
        await supabase
          .from("profiles")
          .update({
            role: "admin",
            org_id: org.id,
            full_name: adminName || null,
          })
          .eq("id", authData.user.id);
      }
    }

    redirect(`/super-admin/orgs/${org.id}`);
  }

  return <CreateOrgForm createOrg={createOrg} />;
}
