"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function updateEmailSetting(
  settingId: string,
  field: "email_to_customer" | "email_to_admin",
  value: boolean
) {
  const auth = await getAuthUser();
  if (!auth || (auth.profile.role !== "admin" && auth.profile.role !== "super_admin")) {
    return { error: "Unauthorized" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("org_email_settings")
    .update({
      [field]: value,
      updated_by: auth.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", settingId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/settings/notifications");
  return { success: true };
}
