"use server";

import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { revalidatePath } from "next/cache";

export async function updateOrgImage(
  field: "logo_url" | "cover_photo_url",
  url: string | null
) {
  const slug = await getFacilitySlug();
  if (!slug) return { error: "No facility context" };

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();

  if (!org) return { error: "Organization not found" };

  const { error } = await supabase
    .from("organizations")
    .update({ [field]: url })
    .eq("id", org.id);

  if (error) return { error: error.message };

  revalidatePath("/admin/settings");
  revalidatePath("/");
  revalidatePath("/my-bookings");

  return { success: true };
}
